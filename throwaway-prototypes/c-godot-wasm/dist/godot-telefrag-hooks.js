window.__telefragReady = window.__telefragReady === true;
window.__prototypeReady = window.__prototypeReady === true;
window.__telefragReadyAt =
  typeof window.__telefragReadyAt === "number" ? window.__telefragReadyAt : null;
window.__telefragBridge = window.__telefragBridge ?? null;
window.__telefragCameraMode = window.__telefragCameraMode || "follow";

(() => {
  const removeGeneratedBranding = () => {
    for (const node of document.querySelectorAll(
      '#-gd-engine-icon, link[rel="apple-touch-icon"]',
    )) {
      node.remove();
    }
  };

  removeGeneratedBranding();
  new MutationObserver(removeGeneratedBranding).observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();
