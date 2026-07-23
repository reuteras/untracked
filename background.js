import { cleanUrl } from "./strip.mjs";
import { createRedirectGuard } from "./redirect-guard.mjs";

const redirectGuard = createRedirectGuard();

chrome.tabs.onRemoved.addListener((tabId) => redirectGuard.forget(tabId));

function handleNavigation(tabId, frameId, url) {
  if (frameId !== 0) return;

  const cleaned = cleanUrl(url);
  if (!cleaned) return;

  if (redirectGuard.isLooping(tabId)) {
    console.warn(
      "[untracked] redirect loop detected, backing off for tab",
      tabId
    );
    return;
  }

  chrome.tabs.update(tabId, { url: cleaned }).catch((err) =>
    console.error("[untracked] tabs.update failed", err)
  );
}

// Handles direct navigations to a URL that already carries tracking params.
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  handleNavigation(details.tabId, details.frameId, details.url);
});

// Handles server-side redirect chains (e.g. newsletter link-tracker
// services) that land on a URL carrying tracking params. onBeforeNavigate
// only fires for the first URL in the chain, so without this, tracked
// params introduced partway through a redirect never get caught. This is
// chrome.webRequest.onBeforeRedirect (observation only, no blocking) —
// note it's a different API from webNavigation.
chrome.webRequest.onBeforeRedirect.addListener(
  (details) => {
    if (details.type !== "main_frame") return;
    handleNavigation(details.tabId, 0, details.redirectUrl);
  },
  { urls: ["<all_urls>"] }
);
