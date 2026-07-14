# Owner-device release checklist

Record the version, commit, device/OS, result, and evidence link for every item.
Do not publish v1 until all applicable checks pass.

## macOS (Apple Silicon and Intel/universal inspection)

- [ ] Download the public DMG and verify its SHA-256 checksum.
- [ ] Clean-install by dragging runAlert to Applications.
- [ ] Confirm first launch passes Gatekeeper without bypass instructions.
- [ ] Run `codesign --verify --deep --strict --verbose=2` on the installed app.
- [ ] Run `spctl --assess --type execute --verbose=2`.
- [ ] Run `xcrun stapler validate` and inspect both `arm64` and `x86_64` with
      `lipo -archs`.
- [ ] Grant notification permission and receive a real milestone notification.
- [ ] Confirm launch-at-login/background monitoring and watcher recovery.
- [ ] Pair by one-click deep link and manual troubleshooting code.
- [ ] Change a setting on web and desktop in both directions.
- [ ] Exercise an offline edit and a deliberate revision conflict.
- [ ] Install the next signed build through the update prompt and restart.
- [ ] Verify Close keeps monitoring, Quit stops all processes, and tray actions work.
- [ ] Uninstall and confirm expected application/support data behavior.

## Windows (Microsoft Store x64)

- [ ] Install from the certified Store listing on a clean owner device.
- [ ] Confirm identity/publisher/version metadata and native notifications.
- [ ] Verify startup/background mode, tray actions, Quit, and watcher recovery.
- [ ] Pair via `runalert://` and the manual troubleshooting code.
- [ ] Verify web↔desktop sync, offline edits, and explicit conflict handling.
- [ ] Receive the next version through Microsoft Store update delivery.
- [ ] Uninstall and confirm expected local-data behavior.

## Durable sync and production

- [ ] Create settings, redeploy Render, and confirm the settings remain in Supabase.
- [ ] Confirm `/health` is ready and `GET /api/releases/stable` reports v1.0.0.
- [ ] Confirm runalert.app title, description, icon, canonical URL, and social card.
- [ ] Download both Mac assets and verify GitHub checksums.
- [ ] Open the Microsoft Store destination from Windows.
- [ ] Confirm permanent credentials, pairing secrets, queries, and streamer names
      are absent from analytics and production logs.
- [ ] Confirm the GitHub release matches the production commit and both branches.
- [ ] Monitor Render health, sanitized errors, sync failures, Supabase usage,
      downloads, and update failures through the launch window.
