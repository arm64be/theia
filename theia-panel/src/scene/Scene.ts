import * as THREE from "three";

export interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.OrthographicCamera;
  renderer: THREE.WebGLRenderer;
  container: HTMLElement;
  pan(dx: number, dy: number): void;
  focusOn(x: number, y: number, targetZoom?: number): void;
  setZoom(z: number): void;
  getZoom(): number;
  dispose(): void;
  resize(): void;
}

export function createScene(container: HTMLElement): SceneContext {
  const scene = new THREE.Scene();

  const { clientWidth: w, clientHeight: h } = container;
  const aspect = w / h;
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

  function apply() {
    const s = baseSize / zoom;
    camera.left = -s * aspect + panX;
    camera.right = s * aspect + panX;
    camera.top = s + panY;
    camera.bottom = -s + panY;
    camera.updateProjectionMatrix();
  }

  const resize = () => {
    const { clientWidth: w2, clientHeight: h2 } = container;
    const a = w2 / h2;
    // Update aspect ratio but keep current zoom/pan
    const s = baseSize / zoom;
    camera.left = -s * a + panX;
    camera.right = s * a + panX;
    camera.top = s + panY;
    camera.bottom = -s + panY;
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
    pan(dxWorld, dyWorld) {
      panX += dxWorld;
      panY += dyWorld;
      apply();
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
      apply();
    },
    getZoom() {
      return zoom;
    },
    resize,
    dispose() {
      ro.disconnect();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    },
  };
}
