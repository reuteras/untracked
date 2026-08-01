// Only http(s) pages have a hostname worth toggling. Chrome's internal
// pages otherwise parse to a non-empty but meaningless hostname — e.g.
// new URL("chrome-error://chromewebdata/").hostname === "chromewebdata" —
// which would let a failed navigation's error page get badged and toggled
// instead of the real site that failed to load. Returns "" for anything
// that isn't http/https, including unparseable input.
export function hostnameOf(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return "";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
  return parsed.hostname;
}

// Tracks hostnames where the user has manually disabled stripping via the
// toolbar action. Matching is by exact hostname — disabling on
// app.sw.broadcom.com does not affect other broadcom.com subdomains.
// Pure in-memory logic; background.js handles loading/saving the set to
// chrome.storage.local so this stays testable with plain Node.
export function createDomainList(initialHostnames = []) {
  const disabled = new Set(initialHostnames);

  function isDisabled(hostname) {
    return disabled.has(hostname);
  }

  // Flips the given hostname's disabled state and returns the new state.
  function toggle(hostname) {
    if (disabled.has(hostname)) {
      disabled.delete(hostname);
      return false;
    }
    disabled.add(hostname);
    return true;
  }

  function toArray() {
    return [...disabled];
  }

  return { isDisabled, toggle, toArray };
}
