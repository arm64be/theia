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
      window.open(
        panelInfo.url + "?graph=" + encodeURIComponent(GRAPH_API),
        "theia-constellation",
        "width=1200,height=800"
      );
    }, [panelInfo.url]);

    var iframeSrc = panelInfo.url + "?graph=" + encodeURIComponent(GRAPH_API);

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
