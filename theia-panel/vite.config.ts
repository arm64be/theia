import { defineConfig } from "vite";

export default defineConfig(({ command }) => ({
  server: {
    ...(command === "serve" ? { fs: { allow: [".."] } } : {}),
  },
  ...(command === "serve" ? { publicDir: "../examples" } : {}),
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
