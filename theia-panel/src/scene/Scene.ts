import * as THREE from "three";

export interface CameraState {
  target: { x: number; y: number; z: number };
  theta: number;
  phi: number;
  zoom: number;
}

export interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  container: HTMLElement;
  pan(dxPixel: number, dyPixel: number): void;
  focusOn(x: number, y: number, targetZoom?: number): void;
  setZoom(z: number): void;
  getZoom(): number;
  rotate(dxPixel: number, dyPixel: number): void;
  getCameraState(): CameraState;
  setCameraState(state: CameraState): void;
  dispose(): void;
  resize(): void;
  /**
   * Register a callback to run after the base scene resize logic
   * (camera + renderer). Used by the post-processing pipeline to keep
   * its render targets in sync — replacing ctx.resize from outside
   * does not work because the internal ResizeObserver captures the
   * original function reference at construction time.
   */
  onResize(fn: () => void): void;
}

// Reference framing: a 60° vertical FOV at a "normal" 16:9 aspect.
// When the container is wider/shorter than this (issue #69 — the panel
// gets squeezed into ~1920×507 inside the dashboard, aspect ≈ 3.79), a
// fixed-vertical-FOV camera makes content read as zoomed-in because the
// same vertical world units are stretched across the full viewport
// while horizontal context is much wider. Recomputing the vertical FOV
// so the *horizontal* extent stays roughly constant gives identical
// perceptual scale at any aspect ratio, without touching the existing
// zoom/radius/focus systems used for user interaction.
const BASE_FOV_DEG = 60;
const BASE_ASPECT = 16 / 9;
const BASE_FOV_TAN_HALF = Math.tan((BASE_FOV_DEG * Math.PI) / 360);

function fovForAspect(a: number): number {
  if (a >= BASE_ASPECT) {
    const tanHalf = (BASE_FOV_TAN_HALF * BASE_ASPECT) / a;
    return (Math.atan(tanHalf) * 360) / Math.PI;
  }
  return BASE_FOV_DEG;
}

export function createScene(container: HTMLElement): SceneContext {
  const scene = new THREE.Scene();

  const { clientWidth: w, clientHeight: h } = container;
  const aspect = w / h;
  const camera = new THREE.PerspectiveCamera(
    fovForAspect(aspect),
    aspect,
    0.01,
    100,
  );

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(w, h, true);
  renderer.domElement.style.display = "block";
  container.appendChild(renderer.domElement);

  let zoom = 1;
  const baseRadius = 5.0;
  let radius = baseRadius / zoom;
  let rafId: number | null = null;

  const target = new THREE.Vector3(0, 0, 0);
  let theta = 0;
  let phi = Math.PI / 2;

  const right = new THREE.Vector3();
  const up = new THREE.Vector3();

  function updateCamera() {
    camera.position.x = target.x + radius * Math.sin(phi) * Math.sin(theta);
    camera.position.y = target.y + radius * Math.cos(phi);
    camera.position.z = target.z + radius * Math.sin(phi) * Math.cos(theta);
    camera.lookAt(target);
  }
  updateCamera();

  const resizeListeners: Array<() => void> = [];

  const resize = () => {
    const { clientWidth: w2, clientHeight: h2 } = container;
    if (w2 === 0 || h2 === 0) return;
    const a = w2 / h2;
    camera.aspect = a;
    camera.fov = fovForAspect(a);
    camera.updateProjectionMatrix();
    // Re-sync DPR — fullscreen transitions and monitor changes can
    // change devicePixelRatio, and the renderer caches it from the
    // first setPixelRatio call.
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(w2, h2, true);
    for (const fn of resizeListeners) fn();
  };

  const ro = new ResizeObserver(resize);
  ro.observe(container);

  return {
    scene,
    camera,
    renderer,
    container,
    pan(dxPixel, dyPixel) {
      const panSpeed = radius * 0.0015;
      right.setFromMatrixColumn(camera.matrixWorld, 0);
      up.setFromMatrixColumn(camera.matrixWorld, 1);
      target.x += (-right.x * dxPixel + up.x * dyPixel) * panSpeed;
      target.y += (-right.y * dxPixel + up.y * dyPixel) * panSpeed;
      target.z += (-right.z * dxPixel + up.z * dyPixel) * panSpeed;
      updateCamera();
    },
    rotate(dxPixel, dyPixel) {
      const rotateSpeed = 0.005;
      theta -= dxPixel * rotateSpeed;
      phi -= dyPixel * rotateSpeed;
      phi = Math.max(0.01, Math.min(Math.PI - 0.01, phi));
      updateCamera();
    },
    focusOn(x: number, y: number, targetZoom?: number) {
      if (rafId !== null) cancelAnimationFrame(rafId);
      const startTarget = target.clone();
      const startRadius = radius;
      const endRadius = baseRadius / (targetZoom ?? zoom);
      const startTime = performance.now();
      const duration = 700;

      function step(now: number) {
        const t = Math.min(1, (now - startTime) / duration);
        const ease = 1 - Math.pow(1 - t, 3);
        target.x = startTarget.x + (x - startTarget.x) * ease;
        target.y = startTarget.y + (y - startTarget.y) * ease;
        target.z = startTarget.z; // keep z unchanged
        radius = startRadius + (endRadius - startRadius) * ease;
        updateCamera();
        if (t < 1) {
          rafId = requestAnimationFrame(step);
        } else {
          rafId = null;
        }
      }
      rafId = requestAnimationFrame(step);
    },
    setZoom(z) {
      zoom = Math.max(0.05, z);
      radius = baseRadius / zoom;
      updateCamera();
    },
    getZoom() {
      return zoom;
    },
    getCameraState() {
      return {
        target: { x: target.x, y: target.y, z: target.z },
        theta,
        phi,
        zoom,
      };
    },
    setCameraState(state) {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      target.set(state.target.x, state.target.y, state.target.z);
      theta = state.theta;
      phi = state.phi;
      zoom = state.zoom;
      radius = baseRadius / zoom;
      updateCamera();
    },
    resize,
    onResize(fn) {
      resizeListeners.push(fn);
    },
    dispose() {
      if (rafId !== null) cancelAnimationFrame(rafId);
      ro.disconnect();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    },
  };
}
