# Agent.md

Instructions for AI agents working on this repository.

## What this is

Untracked is a minimal Manifest V3 WebExtension for Vivaldi/Chromium that
strips tracking query parameters from URLs before navigation completes.
See `SPEC.md` for the full specification — read it before making changes.

## Hard constraints

- **No dependencies.** No `package.json`, no bundler, no npm packages.
  Plain JavaScript only, loadable directly via "Load unpacked". CI tooling
  (GitHub Actions, Dependabot for the `github-actions` and `pre-commit`
  ecosystems — grouped into one PR each, 7-day cooldown before a new
  version is proposed — and pre-commit itself) is fine since none of it
  touches the extension's own dependency graph — just don't let it
  become an excuse to add an npm devDependency. `.pre-commit-config.yaml`
  enforces this: it blocks any commit that adds `package.json`,
  `package-lock.json`, or `node_modules/`.
- **No TypeScript.** Plain JS for v1.
- **No build step.** Files run as-is in the browser. `strip.mjs` uses the
  `.mjs` extension (not `package.json`'s `"type": "module"`) so it's ESM
  in both the browser and Node with zero config.
- **`background.js` scope is narrow.** It only registers the `chrome.*`
  listeners and calls `chrome.*` APIs (`tabs.update`, `storage.local`,
  `action.set*`) — the pure URL-stripping logic (`cleanUrl`,
  `isTrackedParam`, `TRACKED_PARAMS`) lives in `strip.mjs`, the
  redirect-loop circuit breaker lives in `redirect-guard.mjs`, and the
  per-domain disable set lives in `domain-list.mjs`. This split exists so
  all three can be unit-tested with plain Node (no `chrome` global
  available outside the browser).
- **All input is untrusted.** Every URL this code touches comes from the
  open internet, including sites an attacker controls. Don't add
  regex-based URL parsing (parser-differential bugs, ReDoS) or
  dynamic-property param lookups (prototype pollution) — stick to the
  `URL`/`URLSearchParams` API and `Set`/`Map` lookups already in use. See
  "Security Considerations" in `SPEC.md` for the fuller threat model,
  including why `redirect-guard.mjs` exists.
- **Icons are pre-generated.** Don't regenerate or modify files in
  `icons/` unless explicitly asked.
- **Coding style:** prefer clarity over cleverness. This codebase may be
  maintained by non-JS-experts, so favor readable, straightforward code
  over compact or "smart" one-liners.

## Known gotchas

- **Two separate listeners, two separate APIs.** `background.js` listens
  on both `chrome.webNavigation.onBeforeNavigate` (direct navigation to a
  tracked URL) and `chrome.webRequest.onBeforeRedirect` (tracked params
  introduced partway through a server-side redirect chain, e.g.
  newsletter link-tracker services). These are different APIs with
  different permissions (`webNavigation` vs `webRequest`) — do not
  assume `onBeforeRedirect` exists on `webNavigation`, it doesn't.
- An uncaught error while registering a listener (e.g. calling
  `.addListener` on an undefined API) throws during service worker
  startup and silently kills *all* listeners in the file, including
  unrelated ones that were working before. If stripping stops working
  entirely, check the service worker console at `vivaldi://extensions`
  first.
- **`new URL(x).hostname` is non-empty for internal browser pages, not
  just real sites.** `new URL("chrome-error://chromewebdata/").hostname`
  is `"chromewebdata"`, and `chrome://newtab/` is `"newtab"` — both parse
  successfully and look like real hostnames. When a navigation fails
  (e.g. a tracking-redirect service rejects a stripped URL — see
  "Per-domain disable" in `SPEC.md`), Chrome navigates the tab to its
  internal error page, which fires the same `webNavigation`/`webRequest`
  events as a real navigation. Always extract hostnames via
  `hostnameOf()` in `domain-list.mjs`, which filters to `http:`/`https:`
  only — a raw `new URL(url).hostname` call will badge and let the user
  toggle a meaningless pseudo-host instead of the site that actually
  failed.

## Extending the strip list

Add new tracking parameters to the `TRACKED_PARAMS` set in `strip.mjs`.
This should always be a one-line change. Wildcard prefixes (currently
just `utm_`) live in `TRACKED_PREFIXES`. Add a corresponding case to
`test/strip.test.mjs` and to the table in `SPEC.md`.

## Per-domain disable

`domain-list.mjs` tracks hostnames where the user has toggled stripping
off via the toolbar action, matched by **exact hostname** (not
site/eTLD+1). It's pure and testable like `redirect-guard.mjs` — no
`chrome.*` calls inside it. `background.js` owns loading/saving the set
via `chrome.storage.local` and keeping the toolbar badge (`ON`/`OFF`, per
tab) in sync. See "Per-domain disable" in `SPEC.md` for the full design,
including why the initial storage read has to happen asynchronously
after listeners are registered rather than before (MV3 requires
synchronous listener registration at startup).

`options.html`/`options.mjs` is a second, independent context that reads
and writes the same `chrome.storage.local` key to list and remove
exclusions — it does not share in-memory state with `background.js`.
Because of that, `background.js` listens for `chrome.storage.onChanged`
on `disabledHostnames` and rebuilds its own `domainList` (a `let`
binding, reassigned rather than mutated) whenever the set changes
elsewhere. If you add another place that writes `disabledHostnames`,
make sure it goes through the same key so this listener picks it up —
don't invent a second storage key.

`options.mjs` uses `import`, so like the other `.mjs` files it can't be
named `.js` without breaking on Node's default CommonJS parsing (see
"Hard constraints" above) — and it touches the DOM (`document`), so
unlike `domain-list.mjs` it can't be unit-tested with `node --test`;
verify it manually in-browser instead (see `SPEC.md`'s "Testing"
checklist).

## Testing

Run `node --test` before considering any change done — it requires no
dependencies (Node's test runner is built in) and covers `strip.mjs`
(manual test-case list in `SPEC.md`), `redirect-guard.mjs`
(loop-protection behavior, using an injected fake clock rather than real
sleeps — see `test/redirect-guard.test.mjs` for the pattern), and
`domain-list.mjs` (per-domain disable set). CI runs the
same command, plus super-linter, on every push and PR
(`.github/workflows/ci.yml`); both third-party actions there are pinned
to a commit SHA, not a movable tag.

`pre-commit` (`.pre-commit-config.yaml`) runs a fast subset of this
locally on every commit once installed (`pre-commit install`): JSON
validity, `scripts/check-js-syntax.sh`, `node --test`, and the
no-`package.json` guard. It requires the `pre-commit` tool itself
(Python/pipx/brew — not an npm package, see README's "Pre-commit hooks"
section). The `pre-commit-hooks` repo it pulls in is pinned by commit SHA
in the config, same convention as the GitHub Actions.

## Definition of done

A change is complete when:

1. `node --test` passes.
2. The extension loads unpacked in Vivaldi/Chrome with no console errors.
3. A test URL like `https://example.com?utm_source=test&page=1` correctly
   redirects to `https://example.com?page=1`.
4. Clicking the toolbar action toggles stripping for the current tab's
   hostname and the badge reflects the new state.
5. The options page lists disabled hostnames accurately and "Re-enable"
   removes them, reflected immediately in the badge of any open tab on
   that hostname.
6. The manual test cases in `SPEC.md` under "Testing" still pass.

## Out of scope (do not implement without being asked)

- A general settings/configuration page (the options page that exists,
  `options.html`/`options.mjs`, only views/removes per-domain exclusions
  — it does not edit the strip list or any other behavior)
- Badge counters showing how many params were stripped, or a strip-history
  UI (the on/off state badge for per-domain disable, above, is in scope —
  this is about counters/history specifically)
- Cookie/localStorage/tracking-pixel handling
- Firefox support
- Chrome Web Store publishing
- `declarativeNetRequest` migration
- Stripping `ref` or `source` params
