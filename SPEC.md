# Untracked — Extension Specification

## Overview

**Untracked** is a minimal Vivaldi/Chromium browser extension that silently strips tracking query parameters from URLs before a page loads. No UI noise, no telemetry, no configuration required — it just works.

---

## Goals

- Remove known tracking query parameters (UTM, fbclid, gclid, etc.) from all navigated URLs
- Operate silently with zero user interaction required
- Introduce no perceptible latency or navigation flicker
- Stay maintainable: adding new tracking params should be a one-line change
- Ship as a plain WebExtensions MV3 extension with no build step or dependencies

## Non-goals

- Managing cookies or localStorage tracking
- Blocking tracking pixels or network requests
- A general settings/configuration UI — the options page in scope below
  is limited to viewing/removing per-domain exclusions, not editing the
  strip list or any other behavior
- Firefox support (v1 — may be trivial to add later given shared WebExtensions API)
- Publishing to the Chrome Web Store (v1)

---

## Extension Structure

```text
untracked/
├── manifest.json
├── background.js
├── strip.mjs
├── redirect-guard.mjs
├── domain-list.mjs
├── options.html
├── options.mjs
├── test/
│   ├── strip.test.mjs
│   ├── redirect-guard.test.mjs
│   └── domain-list.test.mjs
├── scripts/
│   └── check-js-syntax.sh
├── icons/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
├── .github/
│   ├── workflows/
│   │   └── ci.yml
│   └── dependabot.yml
├── .pre-commit-config.yaml
└── README.md
```

No build step. No `node_modules`. Load unpacked directly.

---

## Manifest

- **Manifest version:** 3
- **Permissions:** `webNavigation`, `webRequest`, `storage`
- **Host permissions:** `<all_urls>`
- **Background:** service worker (`background.js`)
- **Action:** toolbar button (no popup) — click to toggle stripping for
  the current tab's hostname; see "Per-domain disable" below
- **Options page:** `options.html` — lists currently-excluded hostnames
  with a button to re-enable each; reachable via right-click on the
  toolbar icon → "Options", or the "Extension options" link on the
  extension's card in `vivaldi://extensions`

---

## Tracking Parameters

The initial strip list, grouped by origin:

| Parameter | Source |
| --------- | ------ |
| `utm_source` | Google Analytics |
| `utm_medium` | Google Analytics |
| `utm_campaign` | Google Analytics |
| `utm_term` | Google Analytics |
| `utm_content` | Google Analytics |
| `utm_id` | Google Analytics |
| `utm_source_platform` | Google Analytics |
| `fbclid` | Facebook |
| `gclid` | Google Ads |
| `gclsrc` | Google DoubleClick |
| `msclkid` | Microsoft Ads |
| `twclid` | Twitter/X |
| `mc_cid` | Mailchimp |
| `mc_eid` | Mailchimp |
| `_ga` | Google Analytics (cross-domain) |
| `_gl` | Google Analytics (cross-domain) |
| `igshid` | Instagram |
| `li_fat_id` | LinkedIn |
| `ttclid` | TikTok |
| `_bhlid` | beehiiv (newsletter platform) |

Additionally: any parameter matching the pattern `utm_*` is stripped as a wildcard catch-all.

Names are matched **case-insensitively** (`UTM_SOURCE` and `Utm_Medium`
are stripped too) and after percent-decoding, so an obfuscated
`%75tm_source` is still recognised. Entries in `TRACKED_PARAMS` are kept
lowercase.

Parameters deliberately **excluded** from the strip list in v1:

- `ref` — too commonly used for legitimate internal routing (GitHub, Hacker News, etc.)
- `source` — same reason

---

## Core Logic

The background service worker listens on two events, both filtered to the main frame only:

- `chrome.webNavigation.onBeforeNavigate` (`frameId === 0`) — catches direct navigations to a URL that already carries tracking params.
- `chrome.webRequest.onBeforeRedirect` (`type === "main_frame"`) — catches tracking params introduced partway through a server-side redirect chain (e.g. newsletter link-tracker services like beehiiv, which redirect from an opaque tracking URL to the real destination with `utm_*` attached). `onBeforeNavigate` only fires for the *first* URL in a redirect chain, so without this, params added by an intermediate hop are never seen.

Both listeners ignore anything that isn't the active, top-level document
of a real tab: sub-frames (`frameId !== 0`), requests with no tab
(`tabId < 0`), and prerendered documents (`documentLifecycle !==
"active"`, from speculation rules). Acting on a prerender would navigate
the *visible* tab to a page the user never clicked and badge it with the
hidden page's state. The `onBeforeRedirect` listener also passes `types:
["main_frame"]` at registration so sub-resource redirects never wake the
service worker.

Both events feed the same handler:

1. Parse the URL (the navigated-to URL, or the redirect target)
2. Walk the raw query string as `&`-separated pairs and check each name
   (percent-decoded, lowercased) against the strip list
3. If any tracked parameter is found, rebuild the query from the
   remaining pairs **byte-for-byte** and redirect the tab to the cleaned
   URL via `chrome.tabs.update`
4. If no tracked parameters are found, do nothing

Untouched parameters are never re-encoded. Rebuilding the query through
`URLSearchParams` would rewrite `/` to `%2F`, `~` to `%7E`, `%20` to `+`
and a bare `key` to `key=`, which breaks signed URLs (CDN tokens, S3
presigned links) and servers that distinguish `key` from `key=`.

Both events are **observational**: MV3 gives an ordinary extension no way
to block or rewrite a navigation before the request is sent
(`webRequestBlocking` is unavailable, and `declarativeNetRequest` is out
of scope for v1). The navigation to the tracked URL is therefore already
under way when the handler runs, and `chrome.tabs.update` cancels it in
favour of the cleaned URL. What the user sees, keeps in history, and
copies from the address bar is the clean URL; whether the server saw the
tracked request first depends on timing (see "Security Considerations").

### Redirect-loop protection

The extension processes URLs from arbitrary, untrusted sites, including ones designed to abuse it. A malicious page could re-append a tracked param on every load (e.g. reassigning `location.href` in a script) to turn the auto-redirect into a tab-freezing loop. `redirect-guard.mjs` guards against this: it allows a tab 5 redirects within a fixed 3-second window (counted from the tab's first redirect) and, once a tab exceeds that, stops auto-redirecting it. While tripped, every further attempt restarts the clock, so a page that keeps looping stays blocked until it has been quiet for a full 3 seconds. The window is fixed rather than sliding while *under* the limit, so a user clicking tracked links in the same tab every couple of seconds never accumulates into a trip. When tripped, the extension fails open — it leaves the tracked param in place rather than risk hanging the tab — and logs a `console.warn`.

### Edge cases

| Scenario | Handling |
| -------- | -------- |
| URL has no query string | Skip immediately, no-op |
| Fragment (`#`) present | Preserve as-is |
| Duplicate params | All instances removed |
| Only tracking params in query string | Strip all, leave bare path |
| Redirect loops from a well-behaved page | Not possible — cleaned URLs won't re-trigger the listener |
| Redirect loops from a malicious page (param re-added each load) | Circuit breaker in `redirect-guard.mjs` stops intervening after 5 redirects/3s per tab |
| iframes / subframes | Ignored (`frameId !== 0` / `types: ["main_frame"]` filter) |
| Prerendered documents (speculation rules) / requests with no tab | Ignored (`documentLifecycle !== "active"` / `tabId < 0`) — never navigate the visible tab on behalf of a hidden document |
| Tens of thousands of distinct `utm_*` params in one URL | Single pass over the query; 50k params strip in milliseconds (regression test in `test/strip.test.mjs`) |
| Empty segments (`?&&a=1&`) with no tracked params | Left untouched, no-op — only a tracked param justifies a redirect |
| Form `POST` to a URL carrying tracked params | **Known limitation:** the re-navigation is a `GET`, so the body and `Referer` are dropped. `onBeforeNavigate` fires before the request method is known, so this can't be detected in the current design |

---

## Per-domain disable

Some sites break when their tracking params are stripped — for example,
Eloqua-style marketing redirect links (`app.sw.broadcom.com/e/er?...`)
that validate the redirect against the full original query string,
including `utm_*` params. Removing them causes the redirect to fail
instead of just losing some analytics data.

To handle this, the toolbar action (a plain icon button, no popup) lets
the user disable stripping per hostname:

1. Clicking the icon toggles the current tab's hostname in a disabled set
   persisted via `chrome.storage.local`.
2. The toolbar badge always reflects the current tab's state: green
   **ON** when stripping is active for that hostname, red **OFF** when
   disabled.
3. `handleNavigation` in `background.js` checks the navigated-to URL's
   hostname against the disabled set before calling `cleanUrl`, and skips
   stripping entirely (and updates the badge) when disabled.

Matching is by **exact hostname**, not by site/eTLD+1 — disabling on
`app.sw.broadcom.com` does not affect other `broadcom.com` subdomains.
This keeps the matching logic a plain string-set lookup, with no need for
a public-suffix-list-aware domain parser.

The disable logic lives in `domain-list.mjs`, following the same
pure/testable pattern as `strip.mjs` and `redirect-guard.mjs`: it manages
an in-memory `Set` of hostnames with no `chrome.*` calls, so it can be
unit-tested with plain Node. Loading from and saving to
`chrome.storage.local` happens in `background.js`.

Hostnames are extracted via `domain-list.mjs`'s `hostnameOf()`, which
only returns a value for `http:`/`https:` URLs. This matters because a
navigation that fails after stripping (e.g. a tracking-redirect service
that rejects a stripped URL) lands the tab on Chrome's internal error
page, `chrome-error://chromewebdata/` — which fires the same navigation
events as a real page and, unfiltered, parses to a non-empty but
meaningless hostname (`"chromewebdata"`). Without the protocol filter,
the badge would reflect that pseudo-host instead of the site that
actually failed, and clicking the toolbar action while the error page is
showing would silently disable `"chromewebdata"` rather than the real
site — leaving the user unable to fix the failure they were trying to
work around. See "Known gotchas" in `AGENT.md`.

Because MV3 service worker listeners must be registered synchronously at
startup, the initial `chrome.storage.local.get` read happens
asynchronously in the background and every listener awaits that promise
before consulting the disabled set — this avoids a cold-start race where
an early navigation could be stripped despite the hostname being marked
disabled from a previous session.

That initial read **replaces** the in-memory list rather than toggling
each hostname into it. If a storage write from the options page is what
woke the sleeping worker, the `storage.onChanged` listener can run before
the initial read resolves and will already have rebuilt the list from the
fresh value; toggling on top of that would flip every hostname back off
and silently re-enable stripping on sites the user disabled. Replacing is
idempotent whichever order the two land in. The stored value is also
checked with `Array.isArray` and the read's rejection is caught, so a
corrupted value fails open to an empty list instead of poisoning every
later handler with a rejected promise.

`options.html`/`options.mjs` give the user a way to see and remove
exclusions without hunting down every site to click the toolbar icon
again. It reads and writes the same `chrome.storage.local` key directly
(via its own `createDomainList` instance — there's no shared runtime
state between contexts, storage is the single source of truth). Because
of that, `background.js` also listens for `chrome.storage.onChanged` on
`disabledHostnames` and rebuilds its own in-memory `domainList` — and
refreshes every open tab's badge — whenever the set changes from
elsewhere. Without this, re-enabling a hostname from the options page
would leave `background.js`'s copy stale until the service worker
happened to restart, silently continuing to skip stripping for a site
the user just turned back on.

---

## Permissions Rationale

| Permission | Reason |
| ---------- | ------ |
| `webNavigation` | Required to intercept navigation events before load |
| `webRequest` | Required to observe server-side redirects (e.g. newsletter link trackers) before the browser follows them; observation only, no blocking |
| `storage` | Required to persist the set of hostnames where the user has disabled stripping ("Per-domain disable" above) across browser restarts |
| `<all_urls>` | Tracking params appear on any domain. Also what makes `tab.url` readable in `action.onClicked` and `tabs.query` |

The `tabs` permission is deliberately **not** requested. `chrome.tabs.update`
needs no permission at all, and reading `tab.url` is already granted by the
`<all_urls>` host permission, so `tabs` would add nothing but surface area.

No network requests, no access to page content. The only persisted data
is the user-chosen set of disabled hostnames — no browsing history, no
stripped-URL log.

---

## Security Considerations

All URLs the extension processes are untrusted — they come from arbitrary sites, links, and redirect chains on the internet, including ones an attacker controls. Threat model notes:

- **Parsing:** the URL itself is parsed with the browser's native `URL` API. The query string is then walked as plain `&`-separated pairs (`split`/`indexOf`, no regex) and names are percent-decoded with `decodeURIComponent` inside a `try` — no regex-based URL parsing, so no parser-differential bugs or ReDoS. Malformed input is caught and treated as a no-op.
- **Param matching:** `Set.has()` / `startsWith()` on decoded, lowercased string names, not dynamic property access — no prototype-pollution vector even from a param literally named `__proto__`.
- **Algorithmic DoS on the service worker:** the query is filtered in a single linear pass. The earlier per-name `URLSearchParams.delete()` loop was quadratic: a 229 KB URL with 20k distinct `utm_*` names (well inside Chrome's 2 MB limit) took 15 s, 40k took 60 s, and while the worker was stuck stripping stopped in every tab. A regression test holds 50k params under 1 s.
- **No XSS surface:** no content scripts, no DOM/`innerHTML` access (the options page uses `textContent` only), no `eval`, no message passing with page content.
- **Redirect-loop DoS:** a page could otherwise weaponize the auto-redirect into a tab-freezing loop by re-adding a tracked param on every load; mitigated by the circuit breaker in `redirect-guard.mjs` (see "Redirect-loop protection" above).
- **Hidden-document hijack:** prerendered documents and tab-less requests fire the same events as real navigations. Without the `documentLifecycle`/`tabId` guard, a page could declare a speculation-rules prerender of a redirect that lands on a tracked URL, and the extension would `tabs.update` the user's *visible* tab to a page they never clicked. A page can already navigate its own tab, so this doesn't grant new capability, but it would mis-badge the tab and act on the user's behalf without a click. Both listeners drop anything that isn't the active top-level document of a real tab.
- **Extension detectability (accepted trade-off):** any site can detect the extension is installed by observing that its own tracking params disappear from the address bar. This is inherent to what the extension does and isn't fixable without losing the core function.
- **Best-effort stripping (accepted trade-off, and the biggest one):** both `webNavigation.onBeforeNavigate` and `webRequest.onBeforeRedirect` are observation-only. The request to the tracked URL is dispatched by the browser in parallel with the event; whether it has left the machine before `tabs.update` cancels it depends mostly on whether a keep-alive connection to the host already exists, not on the service worker being warm. On a warm connection the server usually sees the tracked request *and* the cleaned one. The guarantee is that the page the user lands on, their history, and the address bar carry the clean URL — not that the server never saw the parameter. Doing better requires `declarativeNetRequest` (`redirect.transform.queryTransform.removeParams` for the fixed list), which acts before the request is sent; see "Future Considerations".
- **`POST` navigations (known limitation):** a form `POST` to a URL carrying tracked params is re-issued as a `GET` without its body or `Referer`. `onBeforeNavigate` fires before the method is known. Rare, but silent.
- **Coincidental param-name collisions (accepted trade-off):** if a site uses one of the stripped names (e.g. `_ga`, `mc_eid`) for something functional rather than tracking, that param gets stripped too — a compatibility risk, not a security one. The per-domain disable toggle is the escape hatch for sites hit by this.
- **Persisted disabled-hostname list:** the only data written to `chrome.storage.local` is hostnames the user explicitly toggled off, via `domain-list.mjs`'s plain `Set`/string matching (no regex, no dynamic property access) — same posture as the param matching above.

---

## Testing

The pure stripping logic (`strip.mjs`) is covered by an automated suite in
`test/strip.test.mjs`, run via Node's built-in test runner (`node --test`,
zero dependencies) and in CI on every push/PR. It covers all the cases
below.

Manual test cases to verify in-browser before any release (the automated
suite can't exercise the actual `chrome.*` redirect behavior):

- [ ] Plain UTM params stripped: `?utm_source=newsletter&utm_medium=email`
- [ ] Mixed params: `?page=2&utm_campaign=spring` → `?page=2`
- [ ] Wildcard catch: `?utm_custom_thing=foo` stripped
- [ ] Case-insensitive: `?UTM_SOURCE=x&page=1` → `?page=1`
- [ ] Untouched params keep their bytes: `?path=/a/b&t=~x&bare&utm_source=x`
      → `?path=/a/b&t=~x&bare` (not `%2F`, `%7E`, `bare=`)
- [ ] No params: navigation unaffected
- [ ] A page with a speculation-rules prerender of a tracked URL does not
      navigate the visible tab away or change its badge
- [ ] Re-enabling a hostname from the options page while the service
      worker is asleep (wait ~30s idle first) leaves the remaining disabled
      hostnames disabled — check their badges still read **OFF**
- [ ] Fragment preserved: `?utm_source=x#section` → `#section`
- [ ] fbclid stripped from Facebook share links
- [ ] gclid stripped from Google Ads links
- [ ] Non-tracked params untouched throughout
- [ ] Tracking params introduced via a server-side redirect chain (e.g. a
      newsletter link-tracker) are stripped from the final URL
- [ ] Clicking the toolbar action on a tracking-sensitive site (e.g. an
      Eloqua redirect link) disables stripping for that hostname, badge
      flips to red **OFF**, and a subsequent navigation with tracking
      params is left untouched
- [ ] Clicking the toolbar action again re-enables stripping, badge flips
      back to green **ON**, and tracking params are stripped again
- [ ] Disabled state survives a browser restart (persisted via
      `chrome.storage.local`)
- [ ] Disabling one hostname does not affect a different hostname on the
      same site (e.g. disabling `app.sw.broadcom.com` doesn't disable
      `www.broadcom.com`)
- [ ] After a stripped navigation fails and Chrome shows its internal
      error page, the badge does not flip to a false **ON**/**OFF** for
      that tab, and clicking the toolbar action does nothing (rather than
      toggling `chromewebdata`) — reload/retry the real URL, disable it,
      then retry again to confirm the real hostname toggles correctly
- [ ] Options page lists every currently-disabled hostname; clicking
      "Re-enable" removes it from the list and the corresponding tab's
      badge flips back to **ON** without needing a reload

---

## Future Considerations (out of scope for v1)

- **Options page** — user-configurable strip list (add/remove params)
- **Badge counter** — show how many params were stripped on the current tab
- **Strip log** — popup showing recent redirects with before/after URLs
- **Firefox support** — likely trivial; manifest adjustments only
- **`declarativeNetRequest` migration** — the only MV3 mechanism that removes params *before* the request is sent, closing the "server sees the tracked request first" gap and the double request. `redirect.transform.queryTransform.removeParams` covers the fixed list exactly (no wildcard); the `utm_*` catch-all would stay on the current `webNavigation` path as a fallback. Deferred in v1 because `removeParams` can't express the wildcard and the two-mechanism split needs in-browser verification
- **`ref` param** — opt-in stripping with a domain allowlist

---

## Development Setup

See README's "Install in Vivaldi" section. No build step or install needed — clone and load unpacked.

For AI-agent-facing constraints (no dependencies, no TypeScript, service worker scope, coding style, CI conventions), see `AGENT.md`.

---

## License

MIT
