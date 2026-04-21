import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

export function createPost(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  container: HTMLElement,
) {
  const composer = new EffectComposer(renderer);
  composer.setSize(container.clientWidth, container.clientHeight);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(container.clientWidth, container.clientHeight),
    2.2, // strength: strong glow
    1.2, // radius: wide enough to bridge diagonal pixel gaps
    0.06, // threshold: catch faint edges but not the background
  );
  composer.addPass(bloom);

  function resize() {
    composer.setSize(container.clientWidth, container.clientHeight);
  }

  return { composer, bloom, resize };
}
