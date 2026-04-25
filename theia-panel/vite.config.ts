import { defineConfig } from "vite";
import { readFileSync } from "fs";
import { resolve } from "path";

const THEIA_HOME =
  process.env.THEIA_HOME || process.env.HERMES_HOME || resolve(process.env.HOME || "/", ".hermes");

export default defineConfig(({ command }) => ({
  server: {
    ...(command === "serve" ? { fs: { allow: [".."] } } : {}),
  },
  ...(command === "serve" ? { publicDir: "../examples" } : {}),
  plugins: [
    ...(command === "serve"
      ? [
          {
            name: "theia-graph",
            configureServer(server: any) {
              function serveGraph(_req: any, res: any, _next: any) {
                try {
                  const data = readFileSync(
                    resolve(THEIA_HOME, "theia-graph.json"),
                    "utf-8",
                  );
                  res.setHeader("Content-Type", "application/json");
                  res.end(data);
                } catch {
                  res.statusCode = 404;
                  res.setHeader("Content-Type", "application/json");
                  res.end(
                    JSON.stringify({
                      error: "theia-graph.json not found in " + THEIA_HOME,
                    }),
                  );
                }
              }
              server.middlewares.use("/theia-graph.json", serveGraph);
              server.middlewares.use(
                "/api/plugins/theia-constellation/graph",
                serveGraph,
              );
            },
          },
        ]
      : []),
  ],
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
