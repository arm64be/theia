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

  // Pass 4: Bayer dithering for retro digital feel
  const DITHER_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
  const DITHER_FRAG = `
uniform sampler2D tDiffuse;
varying vec2 vUv;

// 4x4 Bayer matrix
float bayer(vec2 uv) {
  int x = int(mod(uv.x * 800.0, 4.0));
  int y = int(mod(uv.y * 600.0, 4.0));
  int i = x + y * 4;
  if (i == 0)  return 0.0 / 16.0;
  if (i == 1)  return 8.0 / 16.0;
  if (i == 2)  return 2.0 / 16.0;
  if (i == 3)  return 10.0 / 16.0;
  if (i == 4)  return 12.0 / 16.0;
  if (i == 5)  return 4.0 / 16.0;
  if (i == 6)  return 14.0 / 16.0;
  if (i == 7)  return 6.0 / 16.0;
  if (i == 8)  return 3.0 / 16.0;
  if (i == 9)  return 11.0 / 16.0;
  if (i == 10) return 1.0 / 16.0;
  if (i == 11) return 9.0 / 16.0;
  if (i == 12) return 15.0 / 16.0;
  if (i == 13) return 7.0 / 16.0;
  if (i == 14) return 13.0 / 16.0;
  return 5.0 / 16.0;
}

void main() {
  vec3 col = texture2D(tDiffuse, vUv).rgb;
  // Add bayer noise before quantizing
  float noise = bayer(vUv) - 0.5;
  col += noise * 0.04;
  // Quantize to 32 levels per channel for subtle banding
  col = floor(col * 32.0 + 0.5) / 32.0;
  gl_FragColor = vec4(col, 1.0);
}
`;
  const ditherPass = new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: DITHER_VERT,
    fragmentShader: DITHER_FRAG,
  });
  ditherPass.needsSwap = true;
  composer.addPass(ditherPass);

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
