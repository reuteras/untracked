// Query parameters stripped from every navigated URL.
// Add a new entry here to strip an additional tracking parameter.
// Names are matched case-insensitively (UTM_SOURCE is stripped too), so
// keep entries here lowercase.
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
  const lower = name.toLowerCase();
  if (TRACKED_PARAMS.has(lower)) return true;
  return TRACKED_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

// Decodes a raw query-string key the same way URLSearchParams would
// ("+" is a space, %XX sequences are decoded) so that an obfuscated name
// like "%75tm_source" still matches "utm_source". Malformed percent
// sequences are left as-is rather than throwing.
function decodeName(rawName) {
  const plusDecoded = rawName.replaceAll("+", " ");
  try {
    return decodeURIComponent(plusDecoded);
  } catch {
    return plusDecoded;
  }
}

// Removes tracked params from the URL's query string and returns the
// cleaned URL, or null if nothing needed to change.
//
// The query is filtered as raw "&"-separated pairs rather than rebuilt
// through URLSearchParams. This matters for two reasons:
//
// 1. Untouched params must survive byte-for-byte. Re-serializing through
//    URLSearchParams rewrites "/" to "%2F", "~" to "%7E", "%20" to "+" and
//    a bare "key" to "key=", which breaks signed URLs (CDN tokens, S3
//    presigned links) and servers that distinguish "key" from "key=".
// 2. It is a single pass over the query. Calling searchParams.delete()
//    once per tracked name is a linear scan each time, which let a hostile
//    URL with tens of thousands of distinct utm_* names hang the
//    extension's service worker for minutes.
export function cleanUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (!url.search) return null;

  const kept = [];
  let changed = false;
  for (const pair of url.search.slice(1).split("&")) {
    if (pair === "") {
      // Empty segment from "&&" or a trailing "&". Not kept, but not a
      // reason to redirect on its own either: a URL with no tracked
      // params must stay a no-op.
      continue;
    }
    const eq = pair.indexOf("=");
    const rawName = eq === -1 ? pair : pair.slice(0, eq);
    if (isTrackedParam(decodeName(rawName))) {
      changed = true;
      continue;
    }
    kept.push(pair);
  }

  if (!changed) return null;

  url.search = kept.join("&");
  return url.toString();
}
