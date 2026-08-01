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
const domainListReady = chrome.storage.local
  .get("disabledHostnames")
  .then(({ disabledHostnames }) => {
    for (const hostname of disabledHostnames ?? []) {
      domainList.toggle(hostname);
    }
  });

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

// The options page (options.js) also reads/writes "disabledHostnames"
// directly. Without this, background.js's in-memory domainList would go
// stale as soon as the user re-enables a hostname from that page, and
// keep skipping stripping for it until the service worker happens to
// restart.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.disabledHostnames) return;

  domainList = createDomainList(changes.disabledHostnames.newValue ?? []);

  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id != null) updateBadge(tab.id, hostnameOf(tab.url ?? ""));
    }
  });
});

async function handleNavigation(tabId, frameId, url) {
  if (frameId !== 0) return;

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
