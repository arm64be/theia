import * as THREE from "three";

export interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  container: HTMLElement;
  pan(dx: number, dy: number): void;
  focusOn(x: number, y: number, targetZoom?: number): void;
  setZoom(z: number): void;
  getZoom(): number;
  rotate(dxPixel: number, dyPixel: number): void;
  dispose(): void;
  resize(): void;
}

export function createScene(container: HTMLElement): SceneContext {
  const scene = new THREE.Scene();

  const { clientWidth: w, clientHeight: h } = container;
  let aspect = w / h;
  const baseSize = 2.0; // visible window = larger to accommodate spread
  const camera = new THREE.OrthographicCamera(
    -baseSize * aspect,
    baseSize * aspect,
    baseSize,
    -baseSize,
    -10,
    10,
  );
  camera.position.z = 5;

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(w, h, false);
  renderer.domElement.style.display = "block";
  container.appendChild(renderer.domElement);

  let zoom = 1;
  let panX = 0;
  let panY = 0;
  let rafId: number | null = null;
  const baseRadius = 5.0;
  let radius = baseRadius / zoom;

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

  const resize = () => {
    const { clientWidth: w2, clientHeight: h2 } = container;
    const a = w2 / h2;
    aspect = a;
    apply();
    camera.aspect = a;
    camera.updateProjectionMatrix();
    renderer.setSize(w2, h2, false);
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
      const startPanX = panX;
      const startPanY = panY;
      const startZoom = zoom;
      const endZoom = targetZoom ?? zoom;
      const startTime = performance.now();
      const duration = 700;

      function step(now: number) {
        const t = Math.min(1, (now - startTime) / duration);
        const ease = 1 - Math.pow(1 - t, 3);
        panX = startPanX + (x - startPanX) * ease;
        panY = startPanY + (y - startPanY) * ease;
        zoom = startZoom + (endZoom - startZoom) * ease;
        apply();
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
    resize,
    dispose() {
      if (rafId !== null) cancelAnimationFrame(rafId);
      ro.disconnect();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    },
  };
}
