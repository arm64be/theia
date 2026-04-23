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
      // Bundle everything (including three.js and d3-force-3d)
      // No externals for the embed build
    },
  },
});
