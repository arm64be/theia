/**
 * Single source of truth for panel UI layout & responsive behaviour.
 *
 * Rationale: filter bar, search bar, and side panel are independently mounted
 * absolute overlays on the same container. Their dimensions need to react to
 * each other (e.g. search bar must move when the side panel opens) and to the
 * viewport. We do that with plain CSS classes + media queries instead of
 * bespoke JS resize/coordination logic — no dependencies, no listeners, and
 * one place to read/edit when the layout evolves.
 *
 * Theme-dependent properties (colors, fonts) stay inline on each element so
 * theme switching does not have to touch this stylesheet.
 */

let injected = false;

export function ensureLayoutStyles(): void {
  if (injected) return;
  injected = true;

  const style = document.createElement("style");
  style.dataset.theia = "panel-layout";
  style.textContent = `
    /* Filter bar — top-left. Wraps to multiple rows when toggles + model
       dropdown can't fit, so it never overflows its background. min-height
       matches the search bar so both align on the top row. */
    .tp-filter-bar {
      position: absolute; top: 12px; left: 12px; z-index: 11;
      display: flex; gap: 14px; align-items: center; flex-wrap: wrap;
      padding: 0 14px;
      min-height: 32px;
      max-width: calc(100% - 24px);
      pointer-events: none;
      box-sizing: border-box;
    }
    .tp-filter-bar > * { pointer-events: auto; }

    /* Search bar — top-right by default, height matches filter bar so the
       two are visually aligned. width clamps so it never reaches across
       into the filter bar even on mid-width viewports. */
    .tp-search-bar {
      position: absolute; top: 12px; right: 12px; z-index: 10;
      width: clamp(180px, 30vw, 320px);
      height: 32px;
      font: 13px/1.4 'Mondwest', var(--theia-font, ui-monospace, monospace);
      box-sizing: border-box;
    }
    .tp-search-bar > input {
      width: 100%; height: 100%;
      padding: 0 12px;
      box-sizing: border-box;
    }
    .tp-search-dropdown {
      position: absolute; top: calc(100% + 6px); left: 0; right: 0;
      max-height: 240px; overflow-y: auto;
    }

    /* Side panel — slides in from the right. */
    .tp-side-panel {
      position: absolute; top: 0; right: 0; bottom: 0;
      width: min(420px, 45vw);
      padding: 20px 22px;
      overflow-y: auto; overscroll-behavior: contain;
      box-sizing: border-box; outline: none;
      transform: translateX(100%);
      transition: transform 220ms ease-out;
      z-index: 9;
    }
    .tp-side-panel.tp-side-panel--open { transform: translateX(0); }

    /* When the side panel is open, slide the search bar left of it so neither
       the input nor its dropdown are hidden under the panel. */
    .tp-panel-open .tp-search-bar {
      right: calc(min(420px, 45vw) + 12px);
      width: clamp(180px, calc(55vw - 36px), 320px);
    }

    /* Below this width, the filter bar + panel + search bar can't all share
       the canvas without becoming unusable. Shrink the panel and just hide
       the search bar — the user can close the panel to search again, which
       is cleaner than cramming it into a sliver. */
    @media (max-width: 900px) {
      .tp-side-panel { width: min(320px, 85vw); }
      .tp-panel-open .tp-search-bar { display: none; }
    }
  `;
  document.head.appendChild(style);
}
