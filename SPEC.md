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
- A settings/options UI (v1)
- Firefox support (v1 — may be trivial to add later given shared WebExtensions API)
- Publishing to the Chrome Web Store (v1)

---

## Extension Structure

```
untracked/
├── manifest.json
├── background.js
├── strip.mjs
├── redirect-guard.mjs
├── test/
│   ├── strip.test.mjs
│   └── redirect-guard.test.mjs
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
- **Permissions:** `webNavigation`, `webRequest`, `tabs`
- **Host permissions:** `<all_urls>`
- **Background:** service worker (`background.js`)

---

## Tracking Parameters

The initial strip list, grouped by origin:

| Parameter | Source |
|---|---|
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

Parameters deliberately **excluded** from the strip list in v1:
- `ref` — too commonly used for legitimate internal routing (GitHub, Hacker News, etc.)
- `source` — same reason

---

## Core Logic

The background service worker listens on two events, both filtered to the main frame only:

- `chrome.webNavigation.onBeforeNavigate` (`frameId === 0`) — catches direct navigations to a URL that already carries tracking params.
- `chrome.webRequest.onBeforeRedirect` (`type === "main_frame"`) — catches tracking params introduced partway through a server-side redirect chain (e.g. newsletter link-tracker services like beehiiv, which redirect from an opaque tracking URL to the real destination with `utm_*` attached). `onBeforeNavigate` only fires for the *first* URL in a redirect chain, so without this, params added by an intermediate hop are never seen.

Both events feed the same handler:

1. Parse the URL (the navigated-to URL, or the redirect target)
2. Check each query parameter against the strip list
3. If any tracked parameter is found, delete it and redirect the tab to the cleaned URL via `chrome.tabs.update`
4. If no tracked parameters are found, do nothing

Because `onBeforeRedirect` fires before the browser issues the request to the redirect target, the redirect is preempted before the original page (or intermediate hop) has a chance to load — no request reaches the tracking destination with the parameter intact.

### Redirect-loop protection

The extension processes URLs from arbitrary, untrusted sites, including ones designed to abuse it. A malicious page could re-append a tracked param on every load (e.g. reassigning `location.href` in a script) to turn the auto-redirect into a tab-freezing loop. `redirect-guard.mjs` guards against this: it tracks redirects per tab in a rolling window (5 redirects / 3 seconds by default) and, once a tab exceeds that, stops auto-redirecting it until the window passes quietly. When tripped, the extension fails open — it leaves the tracked param in place rather than risk hanging the tab — and logs a `console.warn`.

### Edge cases

| Scenario | Handling |
|---|---|
| URL has no query string | Skip immediately, no-op |
| Fragment (`#`) present | Preserve as-is |
| Duplicate params | All instances removed |
| Only tracking params in query string | Strip all, leave bare path |
| Redirect loops from a well-behaved page | Not possible — cleaned URLs won't re-trigger the listener |
| Redirect loops from a malicious page (param re-added each load) | Circuit breaker in `redirect-guard.mjs` stops intervening after 5 redirects/3s per tab |
| iframes / subframes | Ignored (`frameId !== 0` / `type !== "main_frame"` guard) |

---

## Permissions Rationale

| Permission | Reason |
|---|---|
| `webNavigation` | Required to intercept navigation events before load |
| `webRequest` | Required to observe server-side redirects (e.g. newsletter link trackers) before the browser follows them; observation only, no blocking |
| `tabs` | Required to redirect the tab to the cleaned URL |
| `<all_urls>` | Tracking params appear on any domain |

No persistent storage, no network requests, no access to page content.

---

## Security Considerations

All URLs the extension processes are untrusted — they come from arbitrary sites, links, and redirect chains on the internet, including ones an attacker controls. Threat model notes:

- **Parsing:** done entirely with the browser's native `URL`/`URLSearchParams` API — no regex-based URL parsing, so no parser-differential bugs or ReDoS. Malformed input is caught and treated as a no-op.
- **Param matching:** `Set.has()` / `startsWith()` on decoded string names, not dynamic property access — no prototype-pollution vector even from a param literally named `__proto__`.
- **No XSS surface:** no content scripts, no DOM/`innerHTML` access, no `eval`, no message passing with page content.
- **Redirect-loop DoS:** a page could otherwise weaponize the auto-redirect into a tab-freezing loop by re-adding a tracked param on every load; mitigated by the circuit breaker in `redirect-guard.mjs` (see "Redirect-loop protection" above).
- **Extension detectability (accepted trade-off):** any site can detect the extension is installed by observing that its own tracking params disappear from the address bar. This is inherent to what the extension does and isn't fixable without losing the core function.
- **Best-effort stripping (accepted trade-off):** `webRequest.onBeforeRedirect` is observation-only; on a cold/slow service worker there's a brief window where a tracked param could still reach the destination server before we redirect away from it.
- **Coincidental param-name collisions (accepted trade-off):** if a site uses one of the stripped names (e.g. `_ga`, `mc_eid`) for something functional rather than tracking, that param gets stripped too — a compatibility risk, not a security one.

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
- [ ] No params: navigation unaffected
- [ ] Fragment preserved: `?utm_source=x#section` → `#section`
- [ ] fbclid stripped from Facebook share links
- [ ] gclid stripped from Google Ads links
- [ ] Non-tracked params untouched throughout
- [ ] Tracking params introduced via a server-side redirect chain (e.g. a
      newsletter link-tracker) are stripped from the final URL

---

## Future Considerations (out of scope for v1)

- **Options page** — user-configurable strip list (add/remove params)
- **Badge counter** — show how many params were stripped on the current tab
- **Strip log** — popup showing recent redirects with before/after URLs
- **Firefox support** — likely trivial; manifest adjustments only
- **`declarativeNetRequest` migration** — avoids the double-navigation; blocked in v1 by the difficulty of expressing wildcard param matching in static rules
- **`ref` param** — opt-in stripping with a domain allowlist
- **Per-domain disable toggle** and **extension store publishing** —
  detailed checklists in `TODO.md`

---

## Development Setup

```bash
git clone https://github.com/<you>/untracked
# No install step needed

# Load in Vivaldi:
# 1. Navigate to vivaldi://extensions
# 2. Enable Developer mode
# 3. Click "Load unpacked" → select the repo root
```

To reload after changes: click the refresh icon on the extension card in `vivaldi://extensions`.

---

## Implementation Notes for Claude Code

- **Icons:** Pre-generated PNGs are included in `icons/` — do not regenerate them
- **README:** Write a brief user-facing README covering: what it does, how to install in Vivaldi, and how to add custom params to the strip list
- **Definition of done:** Extension loads unpacked in Vivaldi/Chrome without console errors and correctly strips UTM params from a test URL such as `https://example.com?utm_source=test&page=1` → `https://example.com?page=1`
- **No dependencies:** Do not introduce a `package.json`, bundler, or any npm packages — the extension must remain plain JS, loadable directly. `strip.mjs` uses the `.mjs` extension specifically so both the browser (MV3 module service worker) and Node's test runner treat it as an ES module without needing a `package.json`
- **No TypeScript:** Plain JavaScript only for v1
- **Service worker scope:** `background.js` only handles registering listeners and calling `chrome.tabs.update` — the pure URL-stripping logic lives in `strip.mjs`, not here
- **CI:** GitHub Actions pins third-party actions to a commit SHA (not a movable tag), per the supply-chain philosophy — see `.github/workflows/ci.yml`
- **Coding style:** Prefer clarity over cleverness; this codebase may be maintained by non-JS-experts

---

## License

MIT
