// Query parameters stripped from every navigated URL.
// Add a new entry here to strip an additional tracking parameter.
export const TRACKED_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "utm_id",
  "utm_source_platform",
  "fbclid",
  "gclid",
  "gclsrc",
  "msclkid",
  "twclid",
  "mc_cid",
  "mc_eid",
  "_ga",
  "_gl",
  "igshid",
  "li_fat_id",
  "ttclid",
  "_bhlid",
]);

// Wildcard catch-all: any param starting with "utm_" is stripped even if
// not explicitly listed above.
export const TRACKED_PREFIXES = ["utm_"];

export function isTrackedParam(name) {
  if (TRACKED_PARAMS.has(name)) return true;
  return TRACKED_PREFIXES.some((prefix) => name.startsWith(prefix));
}

export function cleanUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (!url.search) return null;

  let changed = false;
  for (const name of [...url.searchParams.keys()]) {
    if (isTrackedParam(name)) {
      url.searchParams.delete(name);
      changed = true;
    }
  }

  return changed ? url.toString() : null;
}
