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
