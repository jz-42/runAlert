# runAlert Desktop Shell

This folder contains the Electron wrapper for the existing runAlert dashboard.

- Dev mode starts the Vite dashboard and loads it in an Electron window.
- Packaged mode starts the local Express API and serves the built dashboard from `dashboard/dist`.
- User settings are copied from `config.json` into Electron `userData` on first launch, then saved locally per machine.
- The watcher runs as a managed child process against the local Electron config.
- Closing the window hides it and leaves the app process running; Quit stops the watcher and API.

Useful commands:

```bash
npm run electron:dev
npm run electron:build
```
