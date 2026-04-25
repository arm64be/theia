let injected = false;

export function injectSearchBarStyles(): void {
  if (injected) return;
  injected = true;
  const style = document.createElement("style");
  style.textContent = `
    .tp-search-bar {
      transition: right 220ms ease-out, width 220ms ease-out;
    }
  `;
  document.head.appendChild(style);
}
