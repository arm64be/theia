import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { Pass, FullScreenQuad } from "three/examples/jsm/postprocessing/Pass.js";
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
  vec4 tex = texture2D(tDiffuse, vUv);
  vec3 col = mix(bgColor, tex.rgb, tex.a);
  float noise = bayer(vUv) - 0.5;
  col += noise * 0.04;
  col = floor(col * 32.0 + 0.5) / 32.0;
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  col = vec3(lum);
  gl_FragColor = vec4(col, 1.0);
}
`;

const OVERLAY_FRAG = `
uniform sampler2D tDiffuse;
uniform float uOpacity;
varying vec2 vUv;

void main() {
  vec4 tex = texture2D(tDiffuse, vUv);
  gl_FragColor = vec4(tex.rgb, tex.a * uOpacity);
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

  const edgesTarget = new THREE.WebGLRenderTarget(w * 2, h * 2, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
  });

  const preBloomTarget = new THREE.WebGLRenderTarget(w * dpr, h * dpr, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
  });

  const sceneTarget = new THREE.WebGLRenderTarget(w * dpr, h * dpr, {
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    format: THREE.RGBAFormat,
    type: THREE.UnsignedByteType,
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
    2.2, // strength
    0.8, // radius
    0.06, // threshold
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
  });
  const ditherQuad = new FullScreenQuad(ditherMaterial);

  const overlayMaterial = new THREE.ShaderMaterial({
    uniforms: {
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

    renderer.setRenderTarget(null);
    renderer.setClearColor(PALETTE.background, 1);
    renderer.clear();
    renderer.autoClear = false;

    (ditherMaterial.uniforms.tDiffuse as { value: THREE.Texture | null }).value =
      preBloomTarget.texture;
    ditherQuad.render(renderer);

    (overlayMaterial.uniforms.tDiffuse as { value: THREE.Texture | null }).value =
      sceneTarget.texture;
    overlayQuad.render(renderer);

    renderer.autoClear = prevAutoClear;
    renderer.setClearColor(prevClearColor, prevClearAlpha);
  }

  function resize() {
    const w2 = container.clientWidth;
    const h2 = container.clientHeight;
    const dpr2 = renderer.getPixelRatio();
    edgesTarget.setSize(w2 * 2, h2 * 2);
    preBloomTarget.setSize(w2 * dpr2, h2 * dpr2);
    sceneTarget.setSize(w2 * dpr2, h2 * dpr2);
    composer.setSize(w2, h2);
    bloom.setSize(w2, h2);
  }

  return { composer, edgesTarget, preBloomTarget, sceneTarget, resize, renderEdges, render };
}
