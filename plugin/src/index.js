/**
 * Theia Constellation — Dashboard Plugin
 *
 * Embeds the theia-panel (three.js constellation visualizer) in an iframe
 * inside the Hermes dashboard. Graph data is served by the plugin's backend
 * API at /api/plugins/theia-constellation/graph.
 *
 * Environment awareness:
 *   - Production (default): panel is served from the bundled static build
 *     at /dashboard-plugins/theia-constellation/panel/index.html
 *   - Dev mode: When THEIA_DEV_PORT is set via the API, proxies to a local
 *     Vite dev server for hot-reload (e.g., http://localhost:5173)
 */
(function () {
  "use strict";

  var SDK = window.__HERMES_PLUGIN_SDK__;
  var React = SDK.React;
  var h = React.createElement;
  var useState = SDK.hooks.useState;
  var useEffect = SDK.hooks.useEffect;
  var useCallback = SDK.hooks.useCallback;
  var useRef = SDK.hooks.useRef;
  var useMemo = SDK.hooks.useMemo;
  var Card = SDK.components.Card;
  var CardHeader = SDK.components.CardHeader;
  var CardTitle = SDK.components.CardTitle;
  var CardContent = SDK.components.CardContent;
  var Badge = SDK.components.Badge;
  var Button = SDK.components.Button;

  // -------------------------------------------------------------------
  // Constants
  // -------------------------------------------------------------------
  var PANEL_URL_PROD =
    "/dashboard-plugins/theia-constellation/panel/index.html";
  var GRAPH_API = "/api/plugins/theia-constellation/graph";
  var CONFIG_API = "/api/plugins/theia-constellation/config";

  // -------------------------------------------------------------------
  // Theme extraction — reads the dashboard's CSS custom properties and
  // builds query params the panel can consume to match the host theme.
  //
  // Canvas-based colour resolution is cached per session to avoid
  // creating throwaway <canvas> elements on every render.
  // -------------------------------------------------------------------
  var _cachedCanvas = null;
  var _cachedCtx = null;

  function _getResolverContext() {
    if (!_cachedCtx) {
      _cachedCanvas = document.createElement("canvas");
      _cachedCanvas.width = _cachedCanvas.height = 1;
      _cachedCtx = _cachedCanvas.getContext("2d");
    }
    return _cachedCtx;
  }

  function toHex(color, fallback) {
    if (!color) return fallback;
    if (/^#[0-9a-f]{6,8}$/i.test(color)) return color.replace(/^#/, "");
    try {
      var ctx = _getResolverContext();
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      var d = ctx.getImageData(0, 0, 1, 1).data;
      var hex = ((1 << 24) + (d[0] << 16) + (d[1] << 8) + d[2])
        .toString(16)
        .slice(1);
      if (d[3] < 255) hex += ("0" + d[3].toString(16)).slice(-2);
      return hex;
    } catch (_) {
      return fallback;
    }
  }

  function extractDashboardTheme() {
    var root = getComputedStyle(document.documentElement);
    function cssVar(name) {
      return (root.getPropertyValue(name) || "").trim();
    }
    var bg = toHex(cssVar("--background-base"), "07080d");
    // fg — primary body text: use the midground triplet (theme-responsive).
    var fg = toHex(cssVar("--midground-base"), "cfd6e4");
    // fg2 — secondary/muted labels (55% opacity midground in the DS).
    var fg2 = toHex(
      cssVar("--color-muted-foreground") || cssVar("--midground"),
      "9ca3af",
    );
    // midground — the dashboard's midground layer used e.g. for bg-card blend.
    var midground = toHex(cssVar("--midground-base"), "cfd6e4");
    // accent — try the dashboard's primary/accent color first, then fall
    // back to warning (static #ffbd38), then midground, then the default.
    var accent = toHex(
      cssVar("--color-primary") ||
        cssVar("--color-accent") ||
        cssVar("--color-warning") ||
        cssVar("--midground-base"),
      "ffc477",
    );
    var border = toHex(cssVar("--color-border"), "ffffff26");
    var font =
      root.getPropertyValue("font-family").trim() ||
      "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
    return { bg, fg, fg2, midground, accent, border, font, radius: "0" };
  }

  function buildThemeQuery(theme) {
    var keys = [
      "bg",
      "fg",
      "fg2",
      "midground",
      "accent",
      "border",
      "font",
      "radius",
    ];
    return keys
      .map(function (k) {
        return k + "=" + encodeURIComponent(theme[k]);
      })
      .join("&");
  }

  // -------------------------------------------------------------------
  // Hooks
  // -------------------------------------------------------------------

  /** Resolve the panel iframe URL based on backend config. */
  function usePanelUrl() {
    var state = useState({ url: PANEL_URL_PROD, env: "production" });
    var panelInfo = state[0];
    var setPanelInfo = state[1];

    useEffect(function () {
      SDK.fetchJSON(CONFIG_API)
        .then(function (config) {
          if (config.dev_panel_url) {
            setPanelInfo({ url: config.dev_panel_url, env: "development" });
          } else {
            setPanelInfo({
              url: PANEL_URL_PROD,
              env: config.env || "production",
            });
          }
        })
        .catch(function () {});
    }, []);

    return panelInfo;
  }

  /** Fetch graph stats once on mount. */
  function useGraphStats() {
    var statsState = useState(null);
    var errorState = useState(null);

    useEffect(function () {
      SDK.fetchJSON(GRAPH_API + "?stats=1")
        .then(function (data) {
          statsState[1]({
            nodes: data.nodes ? data.nodes.length : 0,
            edges: data.edges ? data.edges.length : 0,
          });
          errorState[1](null);
        })
        .catch(function (err) {
          errorState[1](
            "Graph data unavailable — " + (err.message || "backend error"),
          );
        });
    }, []);

    return { stats: statsState[0], error: errorState[0] };
  }

  /** Listen for postMessage node-click events from the panel iframe. */
  function useNodeSelection() {
    var selectionState = useState(null);

    useEffect(function () {
      function onMessage(event) {
        if (event.data && event.data.type === "node-click") {
          selectionState[1](event.data.nodeId);
        }
      }
      window.addEventListener("message", onMessage);
      return function () {
        window.removeEventListener("message", onMessage);
      };
    }, []);

    return selectionState;
  }

  /** Track fullscreen state and nudge the iframe to resize. */
  function useFullscreen(containerRef, iframeRef) {
    var fsState = useState(false);

    useEffect(function () {
      function onFsChange() {
        fsState[1](!!document.fullscreenElement);
        setTimeout(function () {
          try {
            if (iframeRef.current && iframeRef.current.contentWindow) {
              iframeRef.current.contentWindow.dispatchEvent(
                new Event("resize"),
              );
            }
          } catch (_) {}
        }, 100);
      }
      document.addEventListener("fullscreenchange", onFsChange);
      return function () {
        document.removeEventListener("fullscreenchange", onFsChange);
      };
    }, []);

    var toggle = useCallback(function () {
      if (!document.fullscreenElement) {
        if (containerRef.current) {
          containerRef.current.requestFullscreen().catch(function () {});
        }
      } else {
        document.exitFullscreen().catch(function () {});
      }
    }, []);

    return { isFullscreen: fsState[0], toggleFullscreen: toggle };
  }

  // -------------------------------------------------------------------
  // Main Page Component
  // -------------------------------------------------------------------
  function ConstellationPage() {
    var iframeRef = useRef(null);
    var containerRef = useRef(null);

    var panelInfo = usePanelUrl();
    var graphInfo = useGraphStats();
    var selectedNodeState = useNodeSelection();
    var selectedNode = selectedNodeState[0];
    var fs = useFullscreen(containerRef, iframeRef);

    // Fill remaining viewport height so the graph isn't squished.
    // The dashboard's Routes wrapper doesn't propagate flex height,
    // so we compute it from the container's position in the viewport.
    useEffect(function () {
      function resizeContainer() {
        var container = containerRef.current;
        if (!container) return;
        var top = container.getBoundingClientRect().top;
        var height = window.innerHeight - top - 32; // 2rem bottom padding
        if (height > 200) {
          container.style.height = height + "px";
        }
      }
      resizeContainer();
      window.addEventListener("resize", resizeContainer);
      return function () {
        window.removeEventListener("resize", resizeContainer);
      };
    }, []);

    // Initial theme — used for the iframe URL on first load
    var initialThemeQuery = useMemo(function () {
      return buildThemeQuery(extractDashboardTheme());
    }, []);

    var iframeSrc = useMemo(
      function () {
        return (
          panelInfo.url +
          "?graph=" +
          encodeURIComponent(GRAPH_API) +
          "&" +
          initialThemeQuery
        );
      },
      [panelInfo.url, initialThemeQuery],
    );

    // Live theme observation — watches :root style mutations (triggered by
    // dashboard theme switches) and forwards updated tokens to the iframe
    // via postMessage so the panel can re-apply without a full reload.
    useEffect(function () {
      var observer = new MutationObserver(function () {
        if (iframeRef.current && iframeRef.current.contentWindow) {
          var tokens = extractDashboardTheme();
          try {
            iframeRef.current.contentWindow.postMessage(
              { type: "theia-theme-update", tokens: tokens },
              "*",
            );
          } catch (_) {}
        }
      });
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["style", "class"],
      });
      return function () {
        observer.disconnect();
      };
    }, []);

    var handleReload = useCallback(function () {
      if (iframeRef.current) {
        iframeRef.current.src = iframeRef.current.src;
      }
    }, []);

    var handlePopout = useCallback(
      function () {
        window.open(iframeSrc, "theia-constellation", "width=1200,height=800");
      },
      [iframeSrc],
    );

    // Environment badge
    var envBadge =
      panelInfo.env !== "production"
        ? h(
            Badge,
            {
              variant: "outline",
              className: "text-xs text-yellow-400 border-yellow-400/40",
            },
            panelInfo.env.toUpperCase(),
          )
        : null;

    return h(
      "div",
      { className: "flex flex-col gap-6" },

      // Header
      h(
        Card,
        null,
        h(
          CardHeader,
          null,
          h(
            "div",
            { className: "flex items-center justify-between w-full" },
            h(
              "div",
              { className: "flex items-center gap-3" },
              h(CardTitle, { className: "text-lg" }, "Session Constellation"),
              h(Badge, { variant: "outline" }, "v0.1.0"),
              envBadge,
              graphInfo.stats &&
                h(
                  Badge,
                  { variant: "outline" },
                  graphInfo.stats.nodes +
                    " sessions / " +
                    graphInfo.stats.edges +
                    " edges",
                ),
            ),
            h(
              "div",
              { className: "flex items-center gap-2" },
              h(
                Button,
                { variant: "outline", size: "sm", onClick: handleReload },
                "Reload",
              ),
              h(
                Button,
                {
                  variant: "outline",
                  size: "sm",
                  onClick: fs.toggleFullscreen,
                },
                fs.isFullscreen ? "Exit Fullscreen" : "Fullscreen",
              ),
              h(
                Button,
                { variant: "outline", size: "sm", onClick: handlePopout },
                "Pop Out",
              ),
            ),
          ),
        ),
        graphInfo.error &&
          h(
            CardContent,
            null,
            h("p", { className: "text-sm text-red-400" }, graphInfo.error),
          ),
      ),

      // Constellation iframe
      h(
        "div",
        { ref: containerRef, className: "theia-container" },
        h("iframe", {
          ref: iframeRef,
          src: iframeSrc,
          className: "theia-iframe",
          allow: "accelerometer; autoplay",
          sandbox: "allow-scripts allow-same-origin",
        }),
      ),

      // Selected node — compact inline row
      selectedNode &&
        h(
          "div",
          {
            role: "status",
            "aria-label": "Selected session " + selectedNode,
            "data-testid": "selected-session-row",
            className: "flex items-center gap-2",
          },
          h(
            Badge,
            {
              variant: "outline",
              className: "font-courier text-xs truncate max-w-[24ch]",
            },
            selectedNode,
          ),
          h(
            Button,
            {
              onClick: function () {
                window.location.href =
                  "/sessions?resume=" + encodeURIComponent(selectedNode);
              },
              variant: "outline",
              size: "sm",
            },
            "View in Sessions",
          ),
        ),
    );
  }

  // Register
  window.__HERMES_PLUGINS__.register("theia-constellation", ConstellationPage);
})();
