/**
 * Theme — reads optional CSS overrides from URL query params and applies
 * them as CSS custom properties on :root.  The 3D rendering canvas is
 * unaffected; only the overlay UI (tooltip, filter bar, side panel, body
 * background) respects these tokens.
 *
 * Supported query params (all optional):
 *   ?bg=041c1c           — UI background color (hex, no #)
 *   &fg=ffe6cb           — primary text / foreground
 *   &fg2=ffffff          — secondary text (muted labels)
 *   &accent=ffc477       — accent / highlight color
 *   &border=ffffff26      — border color (hex with optional alpha)
 *   &font=Courier+Prime  — font family (URL-encoded)
 *   &radius=6            — border-radius in px
 *
 * If no params are provided, the panel falls back to its built-in dark
 * palette — so standalone use is unchanged.
 */

export interface ThemeTokens {
  bg: string;
  fg: string;
  fg2: string;
  accent: string;
  border: string;
  font: string;
  radius: string;
}

const DEFAULTS: ThemeTokens = {
  bg: "07080d",
  fg: "cfd6e4",
  fg2: "9ca3af",
  accent: "ffc477",
  border: "ffffff26",
  font: "ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, monospace",
  radius: "6",
};

/** Read theme tokens from the current URL's query string. */
export function readTheme(): ThemeTokens {
  const params = new URLSearchParams(window.location.search);
  return {
    bg: params.get("bg") || DEFAULTS.bg,
    fg: params.get("fg") || DEFAULTS.fg,
    fg2: params.get("fg2") || DEFAULTS.fg2,
    accent: params.get("accent") || DEFAULTS.accent,
    border: params.get("border") || DEFAULTS.border,
    font: params.get("font")?.replace(/\+/g, " ") || DEFAULTS.font,
    radius: params.get("radius") || DEFAULTS.radius,
  };
}

/** Inject CSS custom properties onto :root and set body styles. */
export function applyTheme(tokens: ThemeTokens): void {
  const root = document.documentElement;

  root.style.setProperty("--theia-bg", `#${tokens.bg}`);
  root.style.setProperty("--theia-fg", `#${tokens.fg}`);
  root.style.setProperty("--theia-fg2", `#${tokens.fg2}`);
  root.style.setProperty("--theia-accent", `#${tokens.accent}`);
  root.style.setProperty("--theia-border", `#${tokens.border}`);
  root.style.setProperty("--theia-font", tokens.font);
  root.style.setProperty("--theia-radius", `${tokens.radius}px`);

  // Apply to body so the chrome around the canvas matches
  document.body.style.backgroundColor = `#${tokens.bg}`;
  document.body.style.color = `#${tokens.fg}`;
  document.body.style.fontFamily = tokens.font;
}

/**
 * Convenience: return an rgba() background string with configurable alpha,
 * using the current theme bg color.
 */
export function themeBgAlpha(tokens: ThemeTokens, alpha: number): string {
  const hex = tokens.bg.replace(/^#/, "");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
