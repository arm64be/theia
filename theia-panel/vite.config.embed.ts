/**
 * Vite config for building a self-contained theia-panel app.
 * Output goes to dist-embed/ — a single HTML page + JS chunk
 * that can be served statically from a Hermes dashboard plugin.
 */
import { defineConfig } from "vite";

export default defineConfig({
  base: "./",
  build: {
    outDir: "dist-embed",
    emptyOutDir: true,
    target: "esnext",
    rollupOptions: {
      // Bundle everything (no externals for embed build).
      // Split heavy deps into separate chunks so each stays <500 kB.
      // The browser fetches them in parallel on first load and caches
      // them independently — three.js rarely changes between releases.
      output: {
        manualChunks: {
          three: ["three"],
          "d3-force": ["d3-force-3d"],
        },
      },
    },
  },
});
