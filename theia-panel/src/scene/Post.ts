import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import {
  Pass,
  FullScreenQuad,
} from "three/examples/jsm/postprocessing/Pass.js";
import { CopyShader } from "three/examples/jsm/shaders/CopyShader.js";
import { PALETTE } from "../aesthetic";

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
  gl_FragColor = mainColor + edgeColor;
}
`;

const DITHER_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const DITHER_FRAG = `
uniform sampler2D tDiffuse;
uniform vec3 bgColor;
varying vec2 vUv;

// A standard 4x4 Bayer Matrix for consistent dithering
float bayer4x4(vec2 uv) {
  ivec2 p = ivec2(mod(gl_FragCoord.xy, 4.0));
  int index = p.x + p.y * 4;
  if (index == 0) return 0.0625;  if (index == 1) return 0.5625;
  if (index == 2) return 0.1875;  if (index == 3) return 0.6875;
  if (index == 4) return 0.8125;  if (index == 5) return 0.3125;
  if (index == 6) return 0.9375;  if (index == 7) return 0.4375;
  if (index == 8) return 0.25;    if (index == 9) return 0.75;
  if (index == 10) return 0.125;  if (index == 11) return 0.625;
  if (index == 12) return 1.0;    if (index == 13) return 0.5;
  if (index == 14) return 0.875;  return 0.375;
}

void main() {
  vec4 tex = texture2D(tDiffuse, vUv);
  vec3 color = tex.rgb;
  color = color / (1.0 + color);
  color = pow(color, vec3(1.0 / 2.2));
  float sceneLum = dot(color, vec3(0.299, 0.587, 0.114));
  float mask = clamp(tex.a * smoothstep(0.0, 0.05, sceneLum), 0.0, 1.0);
  vec3 finalCol = mix(bgColor, color, mask);
  float b = bayer4x4(vUv);
  finalCol += (b - 0.5) * (1.0 / 32.0);
  finalCol = floor(finalCol * 32.0 + 0.5) / 32.0;
  float lum = dot(finalCol, vec3(0.299, 0.587, 0.114));
  gl_FragColor = vec4(vec3(lum), 1.0);
}
`;

const OVERLAY_FRAG = `
uniform sampler2D tDiffuse; // Original Scene (Bloom)
uniform sampler2D tDither;  // Dithered Scene
uniform float uOpacity;
varying vec2 vUv;

void main() {
  vec4 dither = texture2D(tDither, vUv);
  vec4 bloom = texture2D(tDiffuse, vUv);
  bloom = min(bloom, 1.5);
  vec3 bloomMapped = bloom.rgb / (1.0 + bloom.rgb);
  vec3 finalColor = dither.rgb + (bloomMapped * uOpacity);
  gl_FragColor = vec4(finalColor, 1.0);
}
`;

// ---------- save pass ----------

class SavePass extends Pass {
  private material: THREE.ShaderMaterial;
  private fsQuad: FullScreenQuad;

  constructor(private renderTarget: THREE.WebGLRenderTarget) {
    super();
    const shader = CopyShader;
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.clone(shader.uniforms),
      vertexShader: shader.vertexShader,
      fragmentShader: shader.fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.fsQuad = new FullScreenQuad(this.material);
    this.needsSwap = false;
  }

  render(
    renderer: THREE.WebGLRenderer,
    _writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
  ) {
    (this.material.uniforms.tDiffuse as { value: THREE.Texture }).value =
      readBuffer.texture;
    renderer.setRenderTarget(this.renderTarget);
    if (this.clear) renderer.clear();
    this.fsQuad.render(renderer);
  }
}

// ---------- public API ----------

export interface PostContext {
  composer: EffectComposer;
  edgesTarget: THREE.WebGLRenderTarget;
  preBloomTarget: THREE.WebGLRenderTarget;
  sceneTarget: THREE.WebGLRenderTarget;
  resize(): void;
  renderEdges(scene: THREE.Scene, camera: THREE.Camera): void;
  render(): void;
}

export function createPost(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  container: HTMLElement,
): PostContext {
  const w = container.clientWidth;
  const h = container.clientHeight;
  const dpr = renderer.getPixelRatio();

  const edgesTarget = new THREE.WebGLRenderTarget(w * dpr, h * dpr, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
  });

  const preBloomTarget = new THREE.WebGLRenderTarget(w * dpr, h * dpr, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
  });

  const sceneTarget = new THREE.WebGLRenderTarget(w * dpr, h * dpr, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
  });

  const ditherTarget = new THREE.WebGLRenderTarget(w * dpr, h * dpr, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.HalfFloatType,
  });

  const composer = new EffectComposer(renderer);
  composer.setSize(w, h);

  const renderPass = new RenderPass(
    scene,
    camera,
    undefined,
    new THREE.Color(0, 0, 0),
    0,
  );
  composer.addPass(renderPass);

  const compositePass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      tEdges: { value: null },
    },
    vertexShader: COMPOSITE_VERT,
    fragmentShader: COMPOSITE_FRAG,
  });
  (compositePass.uniforms.tEdges as { value: THREE.Texture }).value =
    edgesTarget.texture;
  compositePass.needsSwap = true;
  composer.addPass(compositePass);

  const preBloomSave = new SavePass(preBloomTarget);
  composer.addPass(preBloomSave);

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(w, h),
    1.0, // strength
    0.8, // radius
    0.1, // threshold
  );
  composer.addPass(bloom);

  const savePass = new SavePass(sceneTarget);
  composer.addPass(savePass);

  for (const pass of composer.passes) {
    pass.renderToScreen = false;
  }

  const ditherMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      bgColor: { value: new THREE.Color(PALETTE.background) },
    },
    vertexShader: DITHER_VERT,
    fragmentShader: DITHER_FRAG,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const ditherQuad = new FullScreenQuad(ditherMaterial);

  const overlayMaterial = new THREE.ShaderMaterial({
    uniforms: {
      tDither: { value: null },
      tDiffuse: { value: null },
      uOpacity: { value: 1.0 },
    },
    vertexShader: DITHER_VERT,
    fragmentShader: OVERLAY_FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const overlayQuad = new FullScreenQuad(overlayMaterial);

  function renderEdges(edgesScene: THREE.Scene, edgesCamera: THREE.Camera) {
    const prevTarget = renderer.getRenderTarget();
    const prevClearColor = new THREE.Color();
    const prevClearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(prevClearColor);

    renderer.setRenderTarget(edgesTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(edgesScene, edgesCamera);

    renderer.setRenderTarget(prevTarget);
    renderer.setClearColor(prevClearColor, prevClearAlpha);
  }

  function render() {
    const prevClearColor = new THREE.Color();
    const prevClearAlpha = renderer.getClearAlpha();
    renderer.getClearColor(prevClearColor);
    const prevAutoClear = renderer.autoClear;

    renderer.setClearColor(0, 0);
    composer.render();

    renderer.setRenderTarget(ditherTarget);
    renderer.setClearColor(PALETTE.background, 1);
    renderer.clear();
    renderer.autoClear = false;

    (
      ditherMaterial.uniforms.tDiffuse as { value: THREE.Texture | null }
    ).value = sceneTarget.texture;
    ditherQuad.render(renderer);

    renderer.setRenderTarget(null);
    renderer.clear();

    (
      overlayMaterial.uniforms.tDiffuse as { value: THREE.Texture | null }
    ).value = sceneTarget.texture;
    (
      overlayMaterial.uniforms.tDither as { value: THREE.Texture | null }
    ).value = ditherTarget.texture;
    overlayQuad.render(renderer);

    renderer.autoClear = prevAutoClear;
    renderer.setClearColor(prevClearColor, prevClearAlpha);
  }

  function resize() {
    const w2 = container.clientWidth;
    const h2 = container.clientHeight;
    const dpr2 = renderer.getPixelRatio();
    edgesTarget.setSize(w2 * dpr2, h2 * dpr2);
    preBloomTarget.setSize(w2 * dpr2, h2 * dpr2);
    sceneTarget.setSize(w2 * dpr2, h2 * dpr2);
    composer.setSize(w2, h2);
    bloom.setSize(w2, h2);
  }

  return {
    composer,
    edgesTarget,
    preBloomTarget,
    sceneTarget,
    resize,
    renderEdges,
    render,
  };
}
