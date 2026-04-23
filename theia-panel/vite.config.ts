import { defineConfig } from "vite";
import { theiaWatcherPlugin } from "./vite-plugin-theia-watcher";
import { resolve } from "path";
import { homedir } from "os";

const PROJECT_ROOT = resolve(__dirname, "..");
const SESSIONS_DIR = resolve(homedir(), ".hermes", "sessions");
const OUTPUT_PATH = resolve(PROJECT_ROOT, "examples", "graph.json");
const PYTHON_PATH = resolve(PROJECT_ROOT, ".venv", "bin", "python");

export default defineConfig(({ command }) => ({
  ...(command === "serve"
    ? {
        publicDir: "../examples",
        server: {
          port: 5178,
          fs: { allow: [".."] },
        },
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
  plugins: [
    theiaWatcherPlugin({
      sessionsDir: SESSIONS_DIR,
      outputPath: OUTPUT_PATH,
      pythonPath: PYTHON_PATH,
    }),
  ],
}));
