import * as THREE from "three";
import type { TheiaGraph } from "../data/types";
import { PALETTE } from "../aesthetic";
import { hash01 } from "../util/hash";

const NODE_GLOW_TEXTURE = makeGlowTexture();

function makeGlowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.3, "rgba(255,255,255,0.5)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/** Stellar evolution color based on session age (started_at).
 *  Youngest (hottest) → blue-white, oldest (coolest) → dark red.
 */
function stellarAgeColor(
  startedAt: string,
  minTime: number,
  maxTime: number,
  model?: string,
): THREE.Color {
  const rawT =
    maxTime === minTime
      ? 0.5
      : (Date.parse(startedAt) - minTime) / (maxTime - minTime);
  const t = Math.max(0, Math.min(1, rawT));

  // Stellar-class gradient stops: hot/young → cool/old
  const stops: { t: number; r: number; g: number; b: number }[] = [
    { t: 0.0, r: 0.608, g: 0.71, b: 1.0 }, // blue-white (B-class)
    { t: 0.2, r: 1.0, g: 1.0, b: 1.0 }, // white (A-class)
    { t: 0.4, r: 1.0, g: 0.961, b: 0.882 }, // yellow-white (F-class)
    { t: 0.55, r: 1.0, g: 0.82, b: 0.4 }, // yellow (G-class)
    { t: 0.7, r: 1.0, g: 0.624, b: 0.263 }, // orange (K-class)
    { t: 0.85, r: 0.906, g: 0.298, b: 0.235 }, // red (M-class)
    { t: 1.0, r: 0.36, g: 0.039, b: 0.039 }, // dark red (old M)
  ];

  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (t >= a.t && t <= b.t) {
      const localT = (t - a.t) / (b.t - a.t);
      const c = new THREE.Color();
      c.r = a.r + (b.r - a.r) * localT;
      c.g = a.g + (b.g - a.g) * localT;
      c.b = a.b + (b.b - a.b) * localT;

      // Subtle model tint so same-age stars from different models
      // remain faintly distinguishable without breaking the gradient.
      if (model) {
        const hash = hash01(model);
        const hsl = { h: 0, s: 0, l: 0 };
        c.getHSL(hsl);
        hsl.h = (hsl.h + (hash - 0.5) * 0.05 + 1) % 1;
        hsl.s = Math.min(1, Math.max(0.2, hsl.s + (hash - 0.5) * 0.06));
        hsl.l = Math.min(0.9, Math.max(0.2, hsl.l + (hash - 0.5) * 0.05));
        c.setHSL(hsl.h, hsl.s, hsl.l);
      }
      return c;
    }
  }

  const last = stops[stops.length - 1]!;
  return new THREE.Color(last.r, last.g, last.b);
}

const VERT = `
attribute vec3 aBaseColor;
attribute float aWaveOffset;
attribute float aBrightness;
attribute float aDim;
attribute float aState;

varying vec2 vUv;
varying vec3 vBaseColor;
varying vec3 vCenterPos;
varying float vWaveOffset;
varying float vBrightness;
varying float vDim;
varying float vState;

void main() {
  vUv = uv;
  vBaseColor = aBaseColor;
  vWaveOffset = aWaveOffset;
  vBrightness = aBrightness;
  vDim = aDim;
  vState = aState;

  vec3 instancePos = instanceMatrix[3].xyz;
  // writeMatrix() always sets identity quaternion + uniform scale, so the
  // instance matrix is diagonal-scale + translation. Pull scale straight
  // from the matrix diagonal — equivalent to length(matrix[0].xyz)
  // without three sqrts per vertex.
  float instScale = instanceMatrix[0][0];

  vCenterPos = instancePos;

  vec4 viewPos = viewMatrix * vec4(instancePos, 1.0);
  viewPos.xy += position.xy * instScale;

  gl_Position = projectionMatrix * viewPos;
}
`;

const FRAG = `
precision highp float;
uniform sampler2D map;
uniform float uTime;
uniform vec3 uHighlightColor;
uniform vec3 uSelectedColor;
uniform float uDimFactor;

varying vec2 vUv;
varying vec3 vBaseColor;
varying vec3 vCenterPos;
varying float vWaveOffset;
varying float vBrightness;
varying float vDim;
varying float vState;

void main() {
  vec4 texColor = texture2D(map, vUv);

  // Selected (state=2) and highlighted (state=1) override twinkle/brightness,
  // matching the original CPU-side branching in setTime(). vState is
  // per-instance, so all fragments of a given quad take the same branch
  // — coherent control flow, fine on modern GPUs.
  vec3 tint;
  float effect;
  if (vState > 1.5) {
    tint = uSelectedColor;
    effect = 1.0;
  } else if (vState > 0.5) {
    tint = uHighlightColor;
    effect = 1.0;
  } else {
    tint = vBaseColor;
    float twinkle = 1.0 + 0.12 * sin(uTime * 1.5 + vWaveOffset);
    float dim = mix(1.0, uDimFactor, vDim);
    effect = twinkle * vBrightness * dim;
  }

  vec3 rgb = min(texColor.rgb * tint * effect, vec3(1.0));
  float alpha = texColor.a;
  // cameraPosition is auto-injected by ShaderMaterial — no explicit
  // uniform needed.
  float dist = distance(vCenterPos, cameraPosition);
  float fade = smoothstep(0.15, 0.8, dist);
  alpha *= fade;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(rgb, alpha);
}
`;

export interface NodeLayer {
  mesh: THREE.InstancedMesh;
  count: number;
  setPosition(i: number, x: number, y: number, z: number): void;
  setHighlight(i: number, on: boolean): void;
  setSelected(i: number, on: boolean): void;
  setBrightness(i: number, multiplier: number): void;
  setDim(i: number, on: boolean): void;
  setRevealScale(i: number, scale: number): void;
  setVisible(i: number, visible: boolean): void;
  setTime(t: number): void;
  flush(): void;
  dispose(): void;
}

const DIM_FACTOR = 0.25;

export function createNodes(
  graph: TheiaGraph,
  nodePositions: Float32Array,
): NodeLayer {
  const n = graph.nodes.length;
  const geometry = new THREE.PlaneGeometry(1, 1);
  const highlightColor = new THREE.Color(PALETTE.nodeHighlight);
  const selectedColor = new THREE.Color(PALETTE.nodeSelected);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: NODE_GLOW_TEXTURE },
      uTime: { value: 0 },
      uHighlightColor: {
        value: new THREE.Vector3(
          highlightColor.r,
          highlightColor.g,
          highlightColor.b,
        ),
      },
      uSelectedColor: {
        value: new THREE.Vector3(
          selectedColor.r,
          selectedColor.g,
          selectedColor.b,
        ),
      },
      uDimFactor: { value: DIM_FACTOR },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, n);
  const dummy = new THREE.Object3D();

  // Compute time range for stellar age coloring
  let minTime = Infinity;
  let maxTime = -Infinity;
  for (const node of graph.nodes) {
    const ts = Date.parse(node.started_at);
    if (Number.isFinite(ts)) {
      minTime = Math.min(minTime, ts);
      maxTime = Math.max(maxTime, ts);
    }
  }
  if (!Number.isFinite(minTime)) {
    minTime = 0;
    maxTime = 1;
  }

  const nodeSizes = new Float32Array(n);

  // Per-instance shader inputs. These are uploaded only when their values
  // actually change — not every frame. Twinkle/highlight/dim/select math
  // moved into the fragment shader; setTime() collapses to a single
  // uniform update.
  const baseColorArr = new Float32Array(n * 3);
  const waveOffsetArr = new Float32Array(n);
  const brightnessArr = new Float32Array(n);
  const dimArr = new Float32Array(n);
  const stateArr = new Float32Array(n);

  for (let i = 0; i < n; i++) {
    const node = graph.nodes[i]!;
    const turns = node.message_count ?? node.tool_count;
    nodeSizes[i] = Math.min(0.18, 0.05 + Math.log1p(turns) * 0.014);
    const c = stellarAgeColor(node.started_at, minTime, maxTime, node.model);
    baseColorArr[i * 3 + 0] = c.r;
    baseColorArr[i * 3 + 1] = c.g;
    baseColorArr[i * 3 + 2] = c.b;
    // Spatial wave: coherent ripple across the constellation
    waveOffsetArr[i] =
      node.position.x * 2.0 + node.position.y * 1.5 + hash01(node.id) * 3.0;
    brightnessArr[i] = 1;
    dimArr[i] = 0;
    stateArr[i] = 0;
  }

  const baseColorAttr = new THREE.InstancedBufferAttribute(baseColorArr, 3);
  const waveOffsetAttr = new THREE.InstancedBufferAttribute(waveOffsetArr, 1);
  const brightnessAttr = new THREE.InstancedBufferAttribute(brightnessArr, 1);
  const dimAttr = new THREE.InstancedBufferAttribute(dimArr, 1);
  const stateAttr = new THREE.InstancedBufferAttribute(stateArr, 1);
  brightnessAttr.setUsage(THREE.DynamicDrawUsage);
  dimAttr.setUsage(THREE.DynamicDrawUsage);
  stateAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute("aBaseColor", baseColorAttr);
  geometry.setAttribute("aWaveOffset", waveOffsetAttr);
  geometry.setAttribute("aBrightness", brightnessAttr);
  geometry.setAttribute("aDim", dimAttr);
  geometry.setAttribute("aState", stateAttr);

  for (let i = 0; i < n; i++) {
    const node = graph.nodes[i]!;
    nodePositions[i * 3] = node.position.x;
    nodePositions[i * 3 + 1] = node.position.y;
    nodePositions[i * 3 + 2] = 0;
    dummy.position.set(node.position.x, node.position.y, 0);
    dummy.quaternion.set(0, 0, 0, 1);
    const sz = nodeSizes[i]!;
    dummy.scale.set(sz, sz, sz);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;

  const highlighted = new Set<number>();
  const selected = new Set<number>();
  const visibleFlags = new Array(n).fill(true);
  const revealScales = new Float32Array(n).fill(1);

  function writeMatrix(i: number) {
    const sz = visibleFlags[i] ? nodeSizes[i]! * revealScales[i]! : 0;
    dummy.position.set(
      nodePositions[i * 3]!,
      nodePositions[i * 3 + 1]!,
      nodePositions[i * 3 + 2]!,
    );
    dummy.quaternion.set(0, 0, 0, 1);
    dummy.scale.set(sz, sz, sz);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }

  // Selected wins over highlighted, matching original branching.
  function writeState(i: number) {
    const s = selected.has(i) ? 2 : highlighted.has(i) ? 1 : 0;
    if (stateArr[i] !== s) {
      stateArr[i] = s;
      stateAttr.needsUpdate = true;
    }
  }

  return {
    mesh,
    count: n,
    setPosition(i, x, y, z) {
      nodePositions[i * 3] = x;
      nodePositions[i * 3 + 1] = y;
      nodePositions[i * 3 + 2] = z;
      writeMatrix(i);
    },
    setHighlight(i, on) {
      if (on) highlighted.add(i);
      else highlighted.delete(i);
      writeState(i);
    },
    setSelected(i, on) {
      if (on) selected.add(i);
      else selected.delete(i);
      writeState(i);
    },
    setBrightness(i, multiplier) {
      const v = Math.max(0, multiplier);
      if (brightnessArr[i] !== v) {
        brightnessArr[i] = v;
        brightnessAttr.needsUpdate = true;
      }
    },
    setDim(i, on) {
      const v = on ? 1 : 0;
      if (dimArr[i] !== v) {
        dimArr[i] = v;
        dimAttr.needsUpdate = true;
      }
    },
    setRevealScale(i, scale) {
      revealScales[i] = Math.max(0, scale);
      writeMatrix(i);
    },
    setVisible(i, visible) {
      visibleFlags[i] = visible;
      writeMatrix(i);
    },
    setTime(t: number) {
      material.uniforms.uTime!.value = t;
    },
    flush() {
      mesh.instanceMatrix.needsUpdate = true;
    },
    dispose() {
      geometry.dispose();
      material.dispose();
    },
  };
}
