# runAlert desktop shell

Electron wraps the production dashboard and owns privileged desktop behavior:

- a sandboxed, context-isolated renderer with a narrow preload API;
- a dynamic loopback Express server and supervised watcher child process;
- OS-encrypted device credentials through `safeStorage`;
- first- and second-instance `runalert://` pairing;
- restricted navigation and an allowlist for external HTTPS destinations;
- tray, background monitoring, notifications, update prompts, and clean quit;
- Electron background updates on signed macOS builds (Windows uses Store updates).

Development and unsigned smoke build:

```bash
npm run electron:dev
npm run electron:build
```

Production packaging is intentionally stricter:

```bash
npm run electron:pack:mac  # universal DMG + ZIP; signing/notarization required
npm run electron:pack:win  # Microsoft Store x64 AppX
```

See [Architecture](../docs/ARCHITECTURE.md), [Release process](../docs/RELEASE.md),
and the [owner-device checklist](../docs/OWNER_DEVICE_CHECKLIST.md).
