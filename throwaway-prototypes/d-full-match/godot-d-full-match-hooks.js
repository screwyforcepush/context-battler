(() => {
  window.__d_full_match_boot = {
    startedAt: performance.now(),
  };
  window.__d_full_match_ready = false;
  window.__d_full_match_state = "booting";
  // Default to the project's cloud dev deployment. `npx convex dev` does not
  // run a local backend — it streams logs from the cloud — so any 127.0.0.1
  // default never worked in this environment. This hooks file runs AFTER the
  // build-time inline `runtimeConfigScript` (export-web.mjs:290), so we
  // unconditionally overwrite whatever it set. Hash override (#convex=...)
  // still wins because it is consulted before this value in AppState.gd.
  window.__d_full_match_config = window.__d_full_match_config || {};
  window.__d_full_match_config.defaultConvexUrl =
    "https://calculating-meerkat-923.convex.site";
})();
