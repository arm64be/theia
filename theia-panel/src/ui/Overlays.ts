/**
 * Overlays — small DOM overlays composited above the 3D canvas.
 *
 * Each factory creates an absolutely-positioned `<div>` inside the panel
 * container, exposes update/remove handles, and is otherwise self-contained.
 * The container element is passed in explicitly so these factories don't
 * have to be defined inside the panel's `mount()` closure.
 */

import { FONT_STACK } from "./Theme";
import type { ThemeTokens } from "./Theme";

export function createLoadingOverlay(
  element: HTMLElement,
  text: string,
): { remove(): void } {
  const el = document.createElement("div");
  el.style.cssText = `
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    background: rgba(7,8,13,0.8); color: rgba(255,255,255,0.6);
    font: 13px/1.4 var(--theia-font, ${FONT_STACK});
    letter-spacing: 0.05em; z-index: 20; transition: opacity 300ms;
  `;
  el.textContent = text;
  element.appendChild(el);
  return {
    remove() {
      el.style.opacity = "0";
      setTimeout(() => {
        try {
          element.removeChild(el);
        } catch {
          /* container may have been destroyed during load */
        }
      }, 300);
    },
  };
}

export function createChainOverlay(
  element: HTMLElement,
  theme: ThemeTokens,
  onClear: () => void,
): {
  update(nodeCount: number, edgeCount: number, label: string): void;
  remove(): void;
} {
  const el = document.createElement("div");
  el.setAttribute("data-ui-overlay", "true");
  el.style.cssText = `
    position: absolute; top: 14px; left: 50%; transform: translateX(-50%);
    display: flex; align-items: center; gap: 10px;
    padding: 6px 10px 6px 12px; border: 1px solid #${theme.border};
    background: rgba(7,8,13,0.78); color: #${theme.fg};
    font: 11px/1.2 var(--theia-font, ${FONT_STACK}); letter-spacing: 0.08em;
    text-transform: uppercase; border-radius: ${theme.radius};
    z-index: 13; cursor: default; backdrop-filter: blur(4px);
  `;
  const label = document.createElement("span");
  el.appendChild(label);
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = "✕";
  btn.setAttribute("aria-label", "Clear chain selection");
  btn.style.cssText = `
    appearance: none; border: 0; background: transparent; cursor: pointer;
    color: #${theme.fg2}; font: inherit; padding: 0 2px; line-height: 1;
  `;
  btn.onmouseenter = () => {
    btn.style.color = `#${theme.accent}`;
  };
  btn.onmouseleave = () => {
    btn.style.color = `#${theme.fg2}`;
  };
  btn.onclick = (e) => {
    e.stopPropagation();
    onClear();
  };
  el.appendChild(btn);
  element.appendChild(el);
  return {
    update(nodeCount, edgeCount, kindLabel) {
      label.textContent = `chain · ${kindLabel} · ${nodeCount} node${nodeCount === 1 ? "" : "s"}, ${edgeCount} edge${edgeCount === 1 ? "" : "s"}`;
    },
    remove() {
      try {
        element.removeChild(el);
      } catch {
        /* container may have been destroyed */
      }
    },
  };
}

export function createOnboardingOverlay(element: HTMLElement): {
  update(progress: number): void;
  remove(): void;
} {
  const el = document.createElement("div");
  el.setAttribute("data-ui-overlay", "true");
  el.style.cssText = `
    position: absolute; left: 50%; bottom: 28px; transform: translateX(-50%);
    color: rgba(255,255,255,0.58); font: 11px/1.2 var(--theia-font, ${FONT_STACK});
    letter-spacing: 0.18em; text-transform: uppercase; z-index: 12;
    pointer-events: none; text-align: center; transition: opacity 450ms;
  `;
  element.appendChild(el);
  return {
    update(progress) {
      const pct = Math.max(0, Math.min(100, Math.round(progress * 100)));
      el.textContent = `CREATING YOUR CONSTELLATION - ${pct}%`;
    },
    remove() {
      el.style.opacity = "0";
      setTimeout(() => {
        try {
          element.removeChild(el);
        } catch {
          /* container may have been destroyed */
        }
      }, 450);
    },
  };
}
