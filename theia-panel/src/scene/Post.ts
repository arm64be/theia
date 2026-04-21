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

const BG_TINT_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BG_TINT_FRAG = `
uniform sampler2D tDiffuse;
uniform float uTime;
varying vec2 vUv;

// Simple hash for dither noise
float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Sample the bloomed scene at offset points to gather ambient color
vec3 gatherAmbient(vec2 uv, float radius) {
  vec3 sum = vec3(0.0);
  sum += texture2D(tDiffuse, uv + vec2(radius, 0.0)).rgb;
  sum += texture2D(tDiffuse, uv - vec2(radius, 0.0)).rgb;
  sum += texture2D(tDiffuse, uv + vec2(0.0, radius)).rgb;
  sum += texture2D(tDiffuse, uv - vec2(0.0, radius)).rgb;
  sum += texture2D(tDiffuse, uv + vec2(radius * 0.7, radius * 0.7)).rgb;
  sum += texture2D(tDiffuse, uv - vec2(radius * 0.7, radius * 0.7)).rgb;
  sum += texture2D(tDiffuse, uv + vec2(radius * 0.7, -radius * 0.7)).rgb;
  sum += texture2D(tDiffuse, uv - vec2(radius * 0.7, -radius * 0.7)).rgb;
  return sum / 8.0;
}

void main() {
  // Dark base background
  vec3 bg = vec3(0.027, 0.031, 0.051); // 0x07080d

  // Gather bloomed colors from surroundings — tighter radius for less blur
  float wave = sin(uTime * 0.3 + vUv.x * 4.0 + vUv.y * 3.0) * 0.5 + 0.5;
  float radius = 0.025 + 0.015 * wave;
  vec3 ambient = gatherAmbient(vUv, radius);

  // Second, mid-radius gather
  float wave2 = sin(uTime * 0.2 + vUv.x * 2.5 - vUv.y * 2.0) * 0.5 + 0.5;
  vec3 broad = gatherAmbient(vUv, 0.06 + 0.04 * wave2);

  // Mix: tinted but not washed out
  float tintStrength = 0.25 + 0.10 * wave;
  vec3 tinted = mix(bg, ambient * 0.7 + broad * 0.4, tintStrength);

  // Dither: add subtle grain so the tint feels textured, not blurry
  float noise = hash(vUv * vec2(137.0, 91.0) + uTime * 0.1);
  tinted += (noise - 0.5) * 0.008;

  // Add the actual scene content on top
  vec4 scene = texture2D(tDiffuse, vUv);
  vec3 final = tinted + scene.rgb;

  gl_FragColor = vec4(final, 1.0);
}
`;

export interface PostContext {
  composer: EffectComposer;
  bloom: UnrealBloomPass;
  edgesTarget: THREE.WebGLRenderTarget;
  resize(): void;
  renderEdges(scene: THREE.Scene, camera: THREE.Camera): void;
  setTime(t: number): void;
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

  // Pass 4: atmospheric background tint from bloom colors
  const bgTintPass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uTime: { value: 0 },
    },
    vertexShader: BG_TINT_VERT,
    fragmentShader: BG_TINT_FRAG,
  });
  bgTintPass.needsSwap = true;
  composer.addPass(bgTintPass);

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

  function setTime(t: number) {
    (bgTintPass.uniforms.uTime as { value: number }).value = t;
  }

  return { composer, bloom, edgesTarget, resize, renderEdges, setTime };
}
