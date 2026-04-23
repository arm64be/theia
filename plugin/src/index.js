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
  var Card = SDK.components.Card;
  var CardHeader = SDK.components.CardHeader;
  var CardTitle = SDK.components.CardTitle;
  var CardContent = SDK.components.CardContent;
  var Badge = SDK.components.Badge;
  var Button = SDK.components.Button;
  var cn = SDK.utils.cn;

  // -------------------------------------------------------------------
  // Constants
  // -------------------------------------------------------------------
  var PANEL_URL_PROD = "/dashboard-plugins/theia-constellation/panel/index.html";
  var GRAPH_API = "/api/plugins/theia-constellation/graph";
  var CONFIG_API = "/api/plugins/theia-constellation/config";

  // -------------------------------------------------------------------
  // Theme extraction — reads the dashboard's CSS custom properties and
  // builds query params the panel can consume to match the host theme.
  // -------------------------------------------------------------------
  function extractDashboardTheme() {
    var root = getComputedStyle(document.documentElement);
    function cssVar(name) {
      return (root.getPropertyValue(name) || "").trim();
    }
    // Resolve a CSS color to a 6-digit hex (no #). Falls back to the
    // provided default if the variable is empty or unsupported.
    function toHex(color, fallback) {
      if (!color) return fallback;
      // If it's already a hex
      if (/^#[0-9a-f]{6,8}$/i.test(color)) return color.replace(/^#/, "");
      // Use a canvas to resolve computed colors (handles color-mix, rgb, etc.)
      try {
        var canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        var ctx2d = canvas.getContext("2d");
        ctx2d.fillStyle = color;
        ctx2d.fillRect(0, 0, 1, 1);
        var d = ctx2d.getImageData(0, 0, 1, 1).data;
        var hex = ((1 << 24) + (d[0] << 16) + (d[1] << 8) + d[2]).toString(16).slice(1);
        if (d[3] < 255) hex += ("0" + d[3].toString(16)).slice(-2);
        return hex;
      } catch (_) {
        return fallback;
      }
    }
    var bg = toHex(cssVar("--background-base"), "07080d");
    var fg = toHex(cssVar("--midground-base"), "cfd6e4");
    var fg2 = toHex(cssVar("--color-muted-foreground") || cssVar("--midground"), "9ca3af");
    var accent = toHex(cssVar("--color-warning") || cssVar("--midground-base"), "ffc477");
    var border = toHex(cssVar("--color-border"), "ffffff26");
    // Font — grab the body's computed font-family
    var font = root.getPropertyValue("font-family").trim()
      || "ui-monospace, 'SF Mono', 'Cascadia Mono', Menlo, monospace";
    return { bg: bg, fg: fg, fg2: fg2, accent: accent, border: border, font: font };
  }

  function buildThemeQuery(theme) {
    var parts = [];
    parts.push("bg=" + encodeURIComponent(theme.bg));
    parts.push("fg=" + encodeURIComponent(theme.fg));
    parts.push("fg2=" + encodeURIComponent(theme.fg2));
    parts.push("accent=" + encodeURIComponent(theme.accent));
    parts.push("border=" + encodeURIComponent(theme.border));
    parts.push("font=" + encodeURIComponent(theme.font));
    return parts.join("&");
  }

  // -------------------------------------------------------------------
  // Styles (inline — matches dashboard theme)
  // -------------------------------------------------------------------
  var btnClass = cn(
    "inline-flex items-center gap-1.5 border border-border bg-background/40 px-3 py-1.5",
    "text-xs font-courier transition-colors hover:bg-foreground/10 cursor-pointer"
  );

  // -------------------------------------------------------------------
  // Helper: resolve panel URL based on env
  // -------------------------------------------------------------------
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
            setPanelInfo({ url: PANEL_URL_PROD, env: config.env || "production" });
          }
        })
        .catch(function () {
          // Config endpoint not available — use prod defaults
        });
    }, []);

    return panelInfo;
  }

  // -------------------------------------------------------------------
  // Main Page Component
  // -------------------------------------------------------------------
  function ConstellationPage() {
    var iframeRef = useRef(null);
    var containerRef = useRef(null);
    var selectedNodeState = useState(null);
    var selectedNode = selectedNodeState[0];
    var setSelectedNode = selectedNodeState[1];
    var graphStatsState = useState(null);
    var graphStats = graphStatsState[0];
    var setGraphStats = graphStatsState[1];
    var errorState = useState(null);
    var error = errorState[0];
    var setError = errorState[1];
    var isFullscreenState = useState(false);
    var isFullscreen = isFullscreenState[0];
    var setIsFullscreen = isFullscreenState[1];

    var panelInfo = usePanelUrl();

    // Fetch graph stats on mount
    useEffect(function () {
      SDK.fetchJSON(GRAPH_API + "?stats=1")
        .then(function (data) {
          setGraphStats({
            nodes: data.nodes ? data.nodes.length : 0,
            edges: data.edges ? data.edges.length : 0,
          });
          setError(null);
        })
        .catch(function (err) {
          setError("Graph data unavailable — " + (err.message || "backend error"));
        });
    }, []);

    // Listen for postMessage from iframe
    useEffect(function () {
      function onMessage(event) {
        if (!event.data || !event.data.type) return;
        if (event.data.type === "node-click") {
          setSelectedNode(event.data.nodeId);
        }
      }
      window.addEventListener("message", onMessage);
      return function () {
        window.removeEventListener("message", onMessage);
      };
    }, []);

    var handleReload = useCallback(function () {
      if (iframeRef.current) {
        iframeRef.current.src = iframeRef.current.src;
      }
    }, []);

    var handleFullscreen = useCallback(function () {
      setIsFullscreen(function (prev) { return !prev; });
    }, []);

    var handlePopout = useCallback(function () {
      var popTheme = extractDashboardTheme();
      var popQuery = buildThemeQuery(popTheme);
      window.open(
        panelInfo.url + "?graph=" + encodeURIComponent(GRAPH_API) + "&" + popQuery,
        "theia-constellation",
        "width=1200,height=800"
      );
    }, [panelInfo.url]);

    // Build iframe URL with graph endpoint + theme params from dashboard
    var theme = extractDashboardTheme();
    var themeQuery = buildThemeQuery(theme);
    var iframeSrc = panelInfo.url + "?graph=" + encodeURIComponent(GRAPH_API) + "&" + themeQuery;

    // Environment badge
    var envBadge = panelInfo.env !== "production"
      ? h(Badge, { variant: "outline", className: "text-xs text-yellow-400 border-yellow-400/40" },
          panelInfo.env.toUpperCase())
      : null;

    // Full-screen mode
    if (isFullscreen) {
      return h("div", {
        ref: containerRef,
        className: "theia-fullscreen",
      },
        h("div", { className: "theia-fullscreen-toolbar" },
          h("span", { className: "text-xs font-courier tracking-widest opacity-70" }, "THEIA CONSTELLATION"),
          h("div", { className: "flex items-center gap-2" },
            envBadge,
            selectedNode && h(Badge, { variant: "outline", className: "text-xs" }, selectedNode),
            h(Button, { onClick: handleReload, className: btnClass }, "Reload"),
            h(Button, { onClick: handleFullscreen, className: btnClass }, "Exit Fullscreen")
          )
        ),
        h("iframe", {
          ref: iframeRef,
          src: iframeSrc,
          className: "theia-iframe-full",
          allow: "accelerometer; autoplay",
          sandbox: "allow-scripts allow-same-origin",
        })
      );
    }

    // Normal mode
    return h("div", { className: "flex flex-col gap-6" },

      // Header
      h(Card, null,
        h(CardHeader, null,
          h("div", { className: "flex items-center justify-between w-full" },
            h("div", { className: "flex items-center gap-3" },
              h(CardTitle, { className: "text-lg" }, "Session Constellation"),
              h(Badge, { variant: "outline" }, "v0.1.0"),
              envBadge,
              graphStats && h(Badge, { variant: "outline" },
                graphStats.nodes + " sessions / " + graphStats.edges + " edges"
              )
            ),
            h("div", { className: "flex items-center gap-2" },
              h(Button, { onClick: handleReload, className: btnClass }, "Reload"),
              h(Button, { onClick: handleFullscreen, className: btnClass }, "Fullscreen"),
              h(Button, { onClick: handlePopout, className: btnClass }, "Pop Out")
            )
          )
        ),
        error && h(CardContent, null,
          h("p", { className: "text-sm text-red-400" }, error)
        )
      ),

      // Constellation iframe
      h("div", { ref: containerRef, className: "theia-container" },
        h("iframe", {
          ref: iframeRef,
          src: iframeSrc,
          className: "theia-iframe",
          allow: "accelerometer; autoplay",
          sandbox: "allow-scripts allow-same-origin",
        })
      ),

      // Selected node info
      selectedNode && h(Card, null,
        h(CardHeader, null,
          h(CardTitle, { className: "text-base" }, "Selected Session")
        ),
        h(CardContent, null,
          h("div", { className: "flex items-center gap-3" },
            h("span", { className: "font-courier text-sm" }, selectedNode),
            h(Button, {
              onClick: function () {
                window.location.hash = "#/sessions?id=" + selectedNode;
              },
              className: btnClass,
            }, "View in Sessions")
          )
        )
      )
    );
  }

  // Register
  window.__HERMES_PLUGINS__.register("theia-constellation", ConstellationPage);
})();
