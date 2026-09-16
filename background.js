import { cleanUrl } from "./strip.mjs";
import { createRedirectGuard } from "./redirect-guard.mjs";
import { createDomainList, hostnameOf } from "./domain-list.mjs";

const redirectGuard = createRedirectGuard();
let domainList = createDomainList();

// MV3 listeners must be registered synchronously at startup, so the
// disabled-hostname set is loaded into domainList asynchronously and every
// listener awaits this promise before consulting it. It resolves once,
// almost immediately on a cold start, and immediately after on every
// subsequent call.
//
// The list is *replaced* here, not toggled into. If a storage write from
// the options page is what woke this worker, the onChanged listener below
// can run before this read resolves and has already rebuilt domainList
// from the fresh value; toggling each hostname on top of that would flip
// them all back off. Replacing is idempotent whichever order they land in.
const domainListReady = chrome.storage.local
  .get("disabledHostnames")
  .then(({ disabledHostnames }) => {
    domainList = createDomainList(asHostnameArray(disabledHostnames));
  })
  .catch((err) => {
    // Fail open with an empty list rather than leaving a rejected promise
    // that would make every navigation handler throw from here on.
    console.error("[untracked] failed to load disabledHostnames", err);
  });

// Storage is only ever written by this extension, but a corrupted or
// hand-edited value must not take the whole worker down.
function asHostnameArray(value) {
  return Array.isArray(value) ? value : [];
}

function persistDisabledHostnames() {
  return chrome.storage.local.set({
    disabledHostnames: domainList.toArray(),
  });
}

// Badge always reflects state for the given tab: green "ON" when active,
// red "OFF" when the user has disabled stripping for that hostname. Cleared
// on non-http(s) pages (e.g. chrome://, about:blank) where there's no
// hostname to toggle.
function updateBadge(tabId, hostname) {
  if (!hostname) {
    chrome.action.setBadgeText({ tabId, text: "" });
    return;
  }

  const disabled = domainList.isDisabled(hostname);
  chrome.action.setBadgeText({ tabId, text: disabled ? "OFF" : "ON" });
  chrome.action.setBadgeBackgroundColor({
    tabId,
    color: disabled ? "#c62828" : "#2e7d32",
  });
}

chrome.tabs.onRemoved.addListener((tabId) => redirectGuard.forget(tabId));

// The options page (options.mjs) also reads/writes "disabledHostnames"
// directly. Without this, background.js's in-memory domainList would go
// stale as soon as the user re-enables a hostname from that page, and
// keep skipping stripping for it until the service worker happens to
// restart.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.disabledHostnames) return;

  domainList = createDomainList(
    asHostnameArray(changes.disabledHostnames.newValue)
  );

  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id != null) updateBadge(tab.id, hostnameOf(tab.url ?? ""));
    }
  });
});

// Both navigation listeners below can also fire for documents the user
// isn't looking at: prerendered pages (speculation rules) and requests with
// no tab. Acting on those would navigate the *visible* tab to a page the
// user never clicked, and badge it with the hidden page's state. Only the
// active, top-level document of a real tab is ours to touch.
function isVisibleTopLevelNavigation(details) {
  if (details.tabId == null || details.tabId < 0) return false;
  // documentLifecycle is absent on older Chromium; treat absent as active.
  if (details.documentLifecycle && details.documentLifecycle !== "active") {
    return false;
  }
  return true;
}

async function handleNavigation(tabId, url) {
  await domainListReady;

  const hostname = hostnameOf(url);
  updateBadge(tabId, hostname);
  if (hostname && domainList.isDisabled(hostname)) return;

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
  if (details.frameId !== 0) return;
  if (!isVisibleTopLevelNavigation(details)) return;
  handleNavigation(details.tabId, details.url);
});

// Handles server-side redirect chains (e.g. newsletter link-tracker
// services) that land on a URL carrying tracking params. onBeforeNavigate
// only fires for the first URL in the chain, so without this, tracked
// params introduced partway through a redirect never get caught. This is
// chrome.webRequest.onBeforeRedirect (observation only, no blocking) —
// note it's a different API from webNavigation. The types filter is set
// at registration so sub-resource redirects (images, scripts, XHR) never
// wake the worker at all.
chrome.webRequest.onBeforeRedirect.addListener(
  (details) => {
    if (!isVisibleTopLevelNavigation(details)) return;
    handleNavigation(details.tabId, details.redirectUrl);
  },
  { urls: ["<all_urls>"], types: ["main_frame"] }
);

// Toolbar icon click toggles stripping for the current tab's hostname.
chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  const hostname = hostnameOf(tab.url ?? "");
  if (!hostname) return;

  await domainListReady;
  domainList.toggle(hostname);
  await persistDisabledHostnames();
  updateBadge(tab.id, hostname);
});
