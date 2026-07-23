# Untracked

A minimal Vivaldi/Chromium extension that silently strips tracking query
parameters (UTM, `fbclid`, `gclid`, etc.) from URLs before a page loads.
No UI, no configuration, no telemetry — it just works.

## What it does

When you navigate to a URL, Untracked checks the query string for known
tracking parameters. If any are found, it removes them and redirects the
tab to the cleaned URL before the original page loads — so the tracking
parameters never reach the destination server.

Example:

```
https://example.com?utm_source=newsletter&page=1
→ https://example.com?page=1
```

Non-tracking parameters, fragments (`#section`), and the rest of the URL
are left untouched.

## Install in Vivaldi

1. Clone or download this repository.
2. Open `vivaldi://extensions` in Vivaldi.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select the repository folder.

That's it — no build step, no dependencies. To pick up code changes,
click the refresh icon on the extension's card in `vivaldi://extensions`.

## Adding custom tracking parameters

Open `strip.mjs` and add the parameter name to the `TRACKED_PARAMS` list:

```js
const TRACKED_PARAMS = new Set([
  "utm_source",
  // ...
  "my_custom_param", // add your param here
]);
```

Any parameter starting with `utm_` is stripped automatically, even if
it's not explicitly listed, so you don't need to add every `utm_*`
variant by hand.

## Running the tests

```bash
node --test
```

No dependencies required — this uses Node's built-in test runner against
the pure logic in `strip.mjs`. The same command runs in CI on every push
and pull request, alongside super-linter.

## Pre-commit hooks

This repo uses [pre-commit](https://pre-commit.com/) to catch problems
before they're committed: JSON validity, JS syntax, `node --test`, and a
guard against accidentally adding `package.json`/`node_modules`. One-time
setup after cloning:

```bash
pip install pre-commit  # or: brew install pre-commit / pipx install pre-commit
pre-commit install
```

After that it runs automatically on `git commit`. Run it manually against
everything with `pre-commit run --all-files`.

## Security

Every URL this extension touches comes from the open internet, so it's
written defensively: parsing uses the browser's native `URL` API (no
regex), and a per-tab circuit breaker (`redirect-guard.mjs`) stops the
auto-redirect if a page tries to turn it into a loop. See "Security
Considerations" in `SPEC.md` for the full threat model.

## What it doesn't do (v1)

- No options/settings page
- No cookie or localStorage cleanup
- No network request or tracking-pixel blocking
- No Firefox support
- Not published to the Chrome Web Store

See `SPEC.md` for the full design and future considerations.

## License

MIT
