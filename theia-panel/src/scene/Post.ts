import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";

const COMPOSITE_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const COMPOSITE_FRAG = `
uniform sampler2D tDiffuse;
uniform sampler2D tEdges;
varying vec2 vUv;
void main() {
  vec4 mainColor = texture2D(tDiffuse, vUv);
  vec4 edgeColor = texture2D(tEdges, vUv);
  // edges FBO has transparent background, so just add them
  gl_FragColor = mainColor + edgeColor;
}
`;

export interface PostContext {
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  edgesTarget: THREE.WebGLRenderTarget;
  resize(): void;
  renderEdges(scene: THREE.Scene, camera: THREE.Camera): void;
}

export function createPost(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  container: HTMLElement,
): PostContext {
  const w = container.clientWidth;
  const h = container.clientHeight;

  // High-res render target for edges (2x resolution for smooth diagonals)
  const edgesTarget = new THREE.WebGLRenderTarget(w * 2, h * 2, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
  });

  const composer = new EffectComposer(renderer);
  composer.setSize(w, h);

  // Pass 1: render main scene (without edges)
  composer.addPass(new RenderPass(scene, camera));

  // Pass 2: composite high-res edges onto main scene
  // Don't pass render target texture in constructor — set it after to avoid cloneUniforms error
  const compositePass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      tEdges: { value: null },
    },
    vertexShader: COMPOSITE_VERT,
    fragmentShader: COMPOSITE_FRAG,
  });
  (compositePass.uniforms.tEdges as { value: THREE.Texture }).value = edgesTarget.texture;
  compositePass.needsSwap = true;
  composer.addPass(compositePass);

  // Pass 3: bloom on combined result
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(w, h),
    2.2, // strength
    0.8, // radius
    0.06, // threshold
  );
  composer.addPass(bloom);

  function renderEdges(edgesScene: THREE.Scene, edgesCamera: THREE.Camera) {
    const prevTarget = renderer.getRenderTarget();
    const prevClearColor = new THREE.Color();
    const prevClearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(prevClearColor);

    renderer.setRenderTarget(edgesTarget);
    renderer.setClearColor(0x000000, 0); // transparent clear
    renderer.clear();
    renderer.render(edgesScene, edgesCamera);

    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClearColor, prevClearAlpha);
  }

  function resize() {
    const w2 = container.clientWidth;
    const h2 = container.clientHeight;
    edgesTarget.setSize(w2 * 2, h2 * 2);
    composer.setSize(w2, h2);
  }

  return { composer, bloom, edgesTarget, resize, renderEdges };
}
