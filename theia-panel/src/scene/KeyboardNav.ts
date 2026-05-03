import type { SceneContext } from "./Scene";

export interface KeyboardNav {
  tick(now: number): void;
  dispose(): void;
}

/**
 * Hold-to-move keyboard navigation for the orbital camera.
 *
 * - WASD                : screen-relative pan (W up, S down, A left, D right)
 * - Arrow keys          : orbit (←→ yaw, ↑↓ pitch)
 * - Space               : zoom in
 * - Ctrl                : zoom out (Ctrl+Space also zooms out for users who
 *                         prefer a chord)
 * - Shift (held)        : 3× speed modifier on any of the above
 *
 * Movement integrates per-frame against `now` so hold-to-move is smooth and
 * frame-rate independent. Events are ignored while a text input or
 * contenteditable element has focus, so the search bar still works normally.
 */
export function createKeyboardNav(ctx: SceneContext): KeyboardNav {
  const pressed = new Set<string>();
  let lastTick: number | null = null;

  // Tuned so a 1-second hold gives a "useful" amount of motion at default
  // zoom — pan covers ~30% of viewport, orbit ~60°, zoom doubles/halves.
  const PAN_PIXELS_PER_SEC = 520;
  const ROTATE_PIXELS_PER_SEC = 420;
  const ZOOM_PER_SEC = 1.6; // multiplicative: zoom *= ZOOM_PER_SEC ** dt
  const SHIFT_MULTIPLIER = 3;

  function isTypingTarget(el: EventTarget | null): boolean {
    if (!(el instanceof HTMLElement)) return false;
    if (el.isContentEditable) return true;
    const tag = el.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }

  // Keys we explicitly own — preventDefault on these so arrow keys / space
  // don't scroll the host page when the panel is focused.
  const OWNED_KEYS = new Set([
    "KeyW",
    "KeyA",
    "KeyS",
    "KeyD",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "Space",
  ]);

  function onKeyDown(e: KeyboardEvent) {
    if (isTypingTarget(e.target)) return;
    if (e.altKey || e.metaKey) return;
    pressed.add(e.code);
    if (OWNED_KEYS.has(e.code)) {
      e.preventDefault();
    }
  }

  function onKeyUp(e: KeyboardEvent) {
    pressed.delete(e.code);
  }

  function onBlur() {
    // Drop all pressed state — we won't see the keyup if focus left while
    // a key was held, and a stuck key would scroll the camera forever.
    pressed.clear();
    lastTick = null;
  }

  // Listen on window so the panel works regardless of whether the
  // container itself has focus — but skip when the user is typing.
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  function tick(now: number) {
    if (pressed.size === 0) {
      lastTick = now;
      return;
    }
    if (lastTick === null) {
      lastTick = now;
      return;
    }
    const dt = Math.min(0.1, (now - lastTick) / 1000);
    lastTick = now;
    if (dt <= 0) return;

    const speed =
      pressed.has("ShiftLeft") || pressed.has("ShiftRight")
        ? SHIFT_MULTIPLIER
        : 1;

    // Pan — WASD maps to screen-relative dx/dy in pixel units.
    // Scene.pan treats +dy as "drag down", so W (up) sends -dy.
    let panDx = 0;
    let panDy = 0;
    if (pressed.has("KeyA")) panDx -= 1;
    if (pressed.has("KeyD")) panDx += 1;
    if (pressed.has("KeyW")) panDy -= 1;
    if (pressed.has("KeyS")) panDy += 1;
    if (panDx !== 0 || panDy !== 0) {
      const m = PAN_PIXELS_PER_SEC * dt * speed;
      // Scene.pan internally negates dxPixel (mouse-drag convention),
      // so passing +panDx moves the world left when you press D — which
      // is wrong for a "fly with WASD" feel. Negate to match expectations.
      ctx.pan(-panDx * m, panDy * m);
    }

    // Orbit — arrow keys map to rotate dx/dy.
    let rotDx = 0;
    let rotDy = 0;
    if (pressed.has("ArrowLeft")) rotDx -= 1;
    if (pressed.has("ArrowRight")) rotDx += 1;
    if (pressed.has("ArrowUp")) rotDy -= 1;
    if (pressed.has("ArrowDown")) rotDy += 1;
    if (rotDx !== 0 || rotDy !== 0) {
      const m = ROTATE_PIXELS_PER_SEC * dt * speed;
      ctx.rotate(rotDx * m, rotDy * m);
    }

    // Zoom — Space in (closer), Ctrl out (farther). Ctrl+Space behaves
    // the same as Ctrl alone, since "zoom out" is the dominant intent.
    const zoomIn =
      pressed.has("Space") &&
      !pressed.has("ControlLeft") &&
      !pressed.has("ControlRight");
    const zoomOut = pressed.has("ControlLeft") || pressed.has("ControlRight");
    if (zoomIn || zoomOut) {
      const factor = Math.pow(ZOOM_PER_SEC, dt * speed);
      const next = zoomIn ? ctx.getZoom() * factor : ctx.getZoom() / factor;
      ctx.setZoom(next);
    }
  }

  function dispose() {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    pressed.clear();
  }

  return { tick, dispose };
}
