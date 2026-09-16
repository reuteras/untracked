// Tracks redirects per tab so a malicious page can't turn our auto-redirect
// into a tab-freezing loop by re-adding a tracked param on every navigation
// (e.g. reassigning location.href on load).
//
// Behaviour: a tab may redirect up to `limit` times within a fixed window
// of `windowMs` starting at its first redirect. Once it exceeds that, the
// guard trips and every further attempt restarts the clock, so a page that
// keeps looping stays blocked until it has been quiet for a full
// `windowMs`. The window is only fixed (not sliding) while under the
// limit, so a user clicking tracked links in the same tab every couple of
// seconds never accumulates into a trip.
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
    if (entry.count > limit) {
      // Tripped: keep it tripped until the tab goes quiet for windowMs.
      entry.windowStart = timestamp;
      return true;
    }
    return false;
  }

  function forget(tabId) {
    counts.delete(tabId);
  }

  return { isLooping, forget };
}
