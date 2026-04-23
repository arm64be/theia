import { execFile } from "child_process";
import { promisify } from "util";
import { readdirSync, watch } from "fs";
import type { Plugin } from "vite";

const execFileAsync = promisify(execFile);

export interface TheiaWatcherOptions {
  sessionsDir: string;
  outputPath: string;
  pythonPath: string;
}

export function theiaWatcherPlugin(options: TheiaWatcherOptions): Plugin {
  const { sessionsDir, outputPath, pythonPath } = options;

  return {
    name: "theia-watcher",
    configureServer(server) {
      let rebuilding = false;
      let pendingRebuild = false;
      let rebuildTimeout: ReturnType<typeof setTimeout> | null = null;

      // Track known session files so we only rebuild when NEW files arrive.
      // Existing files being written to (active .jsonl) are ignored.
      let knownFiles = new Set<string>();
      try {
        knownFiles = new Set(
          readdirSync(sessionsDir).filter(
            (f) => f.endsWith(".json") || f.endsWith(".jsonl"),
          ),
        );
      } catch {
        /* ignore */
      }

      async function rebuild() {
        if (rebuilding) {
          pendingRebuild = true;
          return;
        }
        rebuilding = true;
        console.log("\n\x1b[36m[theia]\x1b[0m Rebuilding graph...");
        const start = Date.now();
        try {
          await execFileAsync(pythonPath, [
            "-m",
            "theia_core",
            sessionsDir,
            "-o",
            outputPath,
          ]);
          console.log(
            `\x1b[36m[theia]\x1b[0m Graph rebuilt in ${Date.now() - start}ms → ${outputPath}`,
          );
        } catch (e: any) {
          console.error(
            `\x1b[36m[theia]\x1b[0m Rebuild failed:`,
            e.stderr || e.message,
          );
        } finally {
          rebuilding = false;
          if (pendingRebuild) {
            pendingRebuild = false;
            rebuild();
          }
        }
      }

      function scheduleRebuild() {
        if (rebuildTimeout) clearTimeout(rebuildTimeout);
        rebuildTimeout = setTimeout(rebuild, 3000);
      }

      const watcher = watch(
        sessionsDir,
        { recursive: false },
        (_event, filename) => {
          if (!filename) return;
          if (!filename.endsWith(".json") && !filename.endsWith(".jsonl"))
            return;
          if (knownFiles.has(filename)) return; // ignore existing files
          knownFiles.add(filename);
          scheduleRebuild();
        },
      );

      console.log(
        `\x1b[36m[theia]\x1b[0m Watching ${sessionsDir} for new sessions...`,
      );

      server.httpServer?.on("close", () => {
        watcher.close();
        if (rebuildTimeout) clearTimeout(rebuildTimeout);
      });
    },
  };
}
