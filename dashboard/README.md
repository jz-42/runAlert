# runAlert dashboard

The React/Vite interface for runAlert. It is used both at `runalert.app` and by
the sandboxed Electron renderer.

```bash
npm ci
npm run dev
npm test
npm run lint
npm run build
npm run test:layout
npm run test:a11y
npm run test:visual
```

`VITE_API_BASE` selects the web API during development. In the desktop app the
preload bridge supplies the dynamic loopback address, so packaged builds do not
depend on a fixed local port. Browser device credentials and pending offline
edits live in local storage; desktop credentials are managed by Electron
`safeStorage` and are never exposed through a URL.

Project-wide setup, architecture, privacy, and release instructions are in the
[repository README](../README.md).
