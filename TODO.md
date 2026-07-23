# TODO

Not scheduled — tracked here so they're not forgotten, not implemented yet.

## Per-domain disable (Privacy Badger-style)

Let the user turn stripping off on specific domains, toggled from a
toolbar button, similar to Privacy Badger's per-site switch.

- [ ] Add `storage` permission; use `chrome.storage.local` to persist a
      set of disabled hostnames
- [ ] Add a toolbar `action` (icon button, no popup needed) — clicking it
      toggles the current tab's hostname in the disabled set and flips a
      badge (e.g. color/text) to show on/off state per tab
- [ ] New `domain-list.mjs` module for the enable/disable logic, following
      the same pure/testable pattern as `strip.mjs` and `redirect-guard.mjs`
- [ ] `handleNavigation` in `background.js` checks the current tab's
      hostname against the disabled set before calling `cleanUrl`, and
      skips stripping entirely when disabled
- [ ] Update `SPEC.md`: move this out of "Future Considerations" into
      scope, and document the new `storage` permission's rationale —
      note the "No persistent storage... no access to page content"
      line under "Permissions Rationale" will need to change
- [ ] Update `AGENT.md`'s out-of-scope list and `README.md`

## Extension store publishing (Chrome Web Store, Edge Add-ons, AMO)

### Clarifications

- [ ] Vivaldi has no separate extension store — being Chromium-based, it
      installs from the Chrome Web Store, so "publish for Vivaldi" is the
      same as "publish to the Chrome Web Store"
- [ ] Firefox (AMO) publishing depends on the not-yet-done Firefox
      manifest support (separate item already in `SPEC.md`'s Future
      Considerations)

### One-time manual setup

- [ ] Google Developer account ($5 one-time registration fee) for the
      Chrome Web Store; separate free Microsoft Partner Center account
      for Edge Add-ons
- [ ] A hosted privacy policy — required because the extension requests
      `webNavigation`, `webRequest`, `tabs`, and `<all_urls>`, all of
      which touch user browsing data even though nothing is transmitted
      or stored anywhere; also need a written justification for each of
      those permissions in the store listing (broad host permissions get
      more review scrutiny)
- [ ] Store listing assets: description, category, promotional
      images/screenshots (icons already exist in `icons/`), support URL
- [ ] Budget time for Google's manual + automated review on first
      submission (can take days, longer for `<all_urls>`/`webRequest`
      extensions)

### Auto-publishing (CI)

- [ ] OAuth2 client ID/secret + refresh token for the Chrome Web Store
      Publish API, generated via Google Cloud Console under the
      developer account, stored as GitHub Actions secrets
- [ ] Upload/publish step — prefer calling the official Chrome Web Store
      API directly via `curl` over adding an npm devDependency just for
      this, consistent with this repo's no-dependencies stance
- [ ] Versioning discipline: `manifest.json`'s `version` must bump before
      each publish — the store rejects same-version re-uploads
- [ ] Trigger the publish job on a git tag (e.g. `v1.1.0`), not on every
      push to `main` — this is outward-facing and hard to fully undo
      once users have received the update
- [ ] Require manual approval before the publish step runs (GitHub
      Actions "environment" with required reviewers) — the store-upload
      credential is a high-value secret and a compromise of it would push
      code straight to real users' browsers
