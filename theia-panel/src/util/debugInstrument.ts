/**
 * Diagnostic instrumentation for the iframe-scaling investigation
 * tracked in arm64be/theia#69.
 *
 * When the panel URL contains `?debug=1` (or localStorage holds the key
 * `theia-debug=1`), the panel emits a snapshot of every dimension that
 * could plausibly explain the "iframe content appears ~125% scaled"
 * symptom.  Snapshots fire on:
 *
 *   - first paint (after `mount()` finishes initial setup)
 *   - every container resize observed by the scene's ResizeObserver
 *   - `window.devicePixelRatio` change (covers browser zoom)
 *
 * Each snapshot is both `console.info`'d and `postMessage`'d to the
 * parent frame as `{ type: "theia-debug-info", info }`, so the dashboard
 * plugin (plugin/src/index.js) can mirror the data into the host
 * console for side-by-side comparison with a direct
 * `localhost:5173` page.
 *
 * The whole thing is a no-op when debug isn't enabled — it costs one
 * URLSearchParams parse on import.
 */

export interface DebugSnapshot {
  /** Discriminator so consumers can ignore other postMessage traffic. */
  type: "theia-debug-info";
  /** What triggered the snapshot. */
  reason: "init" | "resize" | "dpr-change";
  /** True when running inside a parent frame (i.e. the Hermes dashboard). */
  embedded: boolean;
  /** `window.devicePixelRatio` at sample time. */
  devicePixelRatio: number;
  /** Browser visual viewport (accounts for pinch-zoom on mobile). */
  visualViewport: { width: number; height: number; scale: number } | null;
  /** Iframe document viewport. */
  innerSize: { width: number; height: number };
  /** Computed `font-size` of the root <html> element, as a number of px. */
  rootFontSizePx: number;
  /** The mount container's CSS box. */
  container: { clientWidth: number; clientHeight: number };
  /** WebGL canvas — both CSS box and backing-buffer attribute size. */
  canvas: {
    cssWidth: number;
    cssHeight: number;
    attrWidth: number;
    attrHeight: number;
  } | null;
  /** Wall-clock timestamp (ms since epoch). */
  ts: number;
}

function isEnabled(): boolean {
  try {
    if (new URLSearchParams(window.location.search).get("debug") === "1") {
      return true;
    }
    return window.localStorage.getItem("theia-debug") === "1";
  } catch {
    return false;
  }
}

function rootFontSize(): number {
  try {
    return parseFloat(getComputedStyle(document.documentElement).fontSize);
  } catch {
    return Number.NaN;
  }
}

function readCanvas(container: HTMLElement): DebugSnapshot["canvas"] {
  const canvas = container.querySelector("canvas");
  if (!canvas) return null;
  const style = getComputedStyle(canvas);
  return {
    cssWidth: parseFloat(style.width),
    cssHeight: parseFloat(style.height),
    attrWidth: canvas.width,
    attrHeight: canvas.height,
  };
}

function snapshot(
  container: HTMLElement,
  reason: DebugSnapshot["reason"],
): DebugSnapshot {
  const vv = window.visualViewport;
  return {
    type: "theia-debug-info",
    reason,
    embedded: window.parent !== window,
    devicePixelRatio: window.devicePixelRatio,
    visualViewport: vv
      ? { width: vv.width, height: vv.height, scale: vv.scale }
      : null,
    innerSize: { width: window.innerWidth, height: window.innerHeight },
    rootFontSizePx: rootFontSize(),
    container: {
      clientWidth: container.clientWidth,
      clientHeight: container.clientHeight,
    },
    canvas: readCanvas(container),
    ts: Date.now(),
  };
}

function publish(info: DebugSnapshot): void {
  // Tag console output so it stands out next to the rest of the panel
  // logging, and is grep-able in browser DevTools.
  // eslint-disable-next-line no-console
  console.info("[theia-debug]", info);
  if (window.parent !== window) {
    try {
      window.parent.postMessage(info, "*");
    } catch {
      /* parent may be cross-origin and have rejected the message; the
         console log above is still visible from the iframe's DevTools. */
    }
  }
}

/**
 * Wire diagnostic logging onto the given container.  Returns a cleanup
 * function (no-op when debug isn't enabled).  Safe to call
 * unconditionally: when the flag isn't set, this is essentially free.
 */
export function startDebugInstrumentation(container: HTMLElement): () => void {
  if (!isEnabled()) return () => {};

  // Defer the first snapshot one tick so the canvas has been appended
  // to the container by createScene().
  const initId = window.setTimeout(
    () => publish(snapshot(container, "init")),
    0,
  );

  let lastDpr = window.devicePixelRatio;
  const dprMedia = window.matchMedia(`(resolution: ${lastDpr}dppx)`);
  function onDprChange() {
    if (window.devicePixelRatio === lastDpr) return;
    lastDpr = window.devicePixelRatio;
    publish(snapshot(container, "dpr-change"));
  }
  // matchMedia is the canonical way to detect DPR changes (zoom in/out).
  // Older Safari needs `addListener`; modern browsers use `addEventListener`.
  if (typeof dprMedia.addEventListener === "function") {
    dprMedia.addEventListener("change", onDprChange);
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (dprMedia as unknown as any).addListener?.(onDprChange);
  }

  // Coalesce noisy resize bursts so the console isn't flooded.
  let pending = 0;
  const ro = new ResizeObserver(() => {
    if (pending) return;
    pending = window.requestAnimationFrame(() => {
      pending = 0;
      publish(snapshot(container, "resize"));
    });
  });
  ro.observe(container);

  return () => {
    window.clearTimeout(initId);
    if (pending) cancelAnimationFrame(pending);
    ro.disconnect();
    if (typeof dprMedia.removeEventListener === "function") {
      dprMedia.removeEventListener("change", onDprChange);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (dprMedia as unknown as any).removeListener?.(onDprChange);
    }
  };
}
