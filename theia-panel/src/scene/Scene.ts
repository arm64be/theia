import * as THREE from "three";

export interface SceneContext {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  container: HTMLElement;
  pan(dxPixel: number, dyPixel: number): void;
  setZoom(z: number): void;
  getZoom(): number;
  rotate(dxPixel: number, dyPixel: number): void;
  dispose(): void;
  resize(): void;
}

export function createScene(container: HTMLElement): SceneContext {
  const scene = new THREE.Scene();

  const { clientWidth: w, clientHeight: h } = container;
  const aspect = w / h;
  const camera = new THREE.PerspectiveCamera(60, aspect, 0.01, 100);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(w, h, false);
  renderer.domElement.style.display = "block";
  container.appendChild(renderer.domElement);

  let zoom = 1;
  const baseRadius = 5.0;
  let radius = baseRadius / zoom;

  const target = new THREE.Vector3(0, 0, 0);
  let theta = 0;
  let phi = Math.PI / 2;

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
      const m = camera.matrixWorld.elements;
      target.x += (-m[0] * dxPixel + m[4] * dyPixel) * panSpeed;
      target.y += (-m[1] * dxPixel + m[5] * dyPixel) * panSpeed;
      target.z += (-m[2] * dxPixel + m[6] * dyPixel) * panSpeed;
      updateCamera();
    },
    rotate(dxPixel, dyPixel) {
      const rotateSpeed = 0.005;
      theta -= dxPixel * rotateSpeed;
      phi -= dyPixel * rotateSpeed;
      phi = Math.max(0.01, Math.min(Math.PI - 0.01, phi));
      updateCamera();
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
      ro.disconnect();
      renderer.dispose();
      container.removeChild(renderer.domElement);
    },
  };
}
