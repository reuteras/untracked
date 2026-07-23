// Tracks redirects per tab so a malicious page can't turn our auto-redirect
// into a tab-freezing loop by re-adding a tracked param on every navigation
// (e.g. reassigning location.href on load). Once a tab exceeds `limit`
// redirects within `windowMs`, isLooping() reports true until the window
// passes without another redirect attempt.
export function createRedirectGuard({
  limit = 5,
  windowMs = 3000,
  now = Date.now,
} = {}) {
  const counts = new Map();

  function isLooping(tabId) {
    const timestamp = now();
    const entry = counts.get(tabId);

    if (!entry || timestamp - entry.windowStart > windowMs) {
      counts.set(tabId, { count: 1, windowStart: timestamp });
      return false;
    }

    entry.count += 1;
    return entry.count > limit;
  }

  function forget(tabId) {
    counts.delete(tabId);
  }

  return { isLooping, forget };
}
