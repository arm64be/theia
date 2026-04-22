import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  ...(command === "serve"
    ? {
        publicDir: "../examples",
        server: { fs: { allow: [".."] } },
      }
    : {}),
  build: {
    lib: {
      entry: "src/index.ts",
      name: "theia",
      formats: ["es"],
      fileName: "theia-panel",
    },
    rollupOptions: { external: ["three", "d3-force-3d"] },
  },
}));
