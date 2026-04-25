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
       dropdown can't fit, so it never overflows its background. */
    .tp-filter-bar {
      position: absolute; top: 12px; left: 12px; z-index: 11;
      display: flex; gap: 14px; align-items: center; flex-wrap: wrap;
      padding: 6px 14px;
      max-width: calc(100% - 24px);
      pointer-events: none;
      box-sizing: border-box;
    }
    .tp-filter-bar > * { pointer-events: auto; }

    /* Search bar — top-right by default; width clamps so it never reaches
       across into the filter bar even on mid-width viewports. */
    .tp-search-bar {
      position: absolute; top: 12px; right: 12px; z-index: 10;
      width: clamp(180px, 30vw, 320px);
      font: 13px/1.4 'Mondwest', var(--theia-font, ui-monospace, monospace);
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

    /* Narrow viewports: shrink the panel and stack the search bar at the
       bottom-left when the panel is open — there is no longer room for both
       filter bar and search bar on the top row. */
    @media (max-width: 900px) {
      .tp-side-panel { width: min(320px, 85vw); }

      .tp-panel-open .tp-search-bar {
        top: auto; right: auto; bottom: 12px; left: 12px;
        width: clamp(180px, calc(100% - min(320px, 85vw) - 24px), 320px);
      }
      /* Bottom-anchored search => dropdown must open upward. */
      .tp-panel-open .tp-search-bar .tp-search-dropdown {
        top: auto;
        bottom: calc(100% + 6px);
      }
    }
  `;
  document.head.appendChild(style);
}
