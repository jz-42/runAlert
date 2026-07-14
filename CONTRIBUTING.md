# Contributing to runAlert

Thanks for helping improve runAlert. Focused bug fixes, tests, documentation, and
accessibility improvements are especially useful.

## Workflow

1. Open an issue for changes that affect product behavior or public contracts.
2. Branch from `dev`; `main` is production-only.
3. Use Node 24.17.x and install with `npm run workspace:setup`.
4. Add or update tests before changing behavior.
5. Run the checks below and open a pull request into `dev`.

```bash
npm run test:backend
npm run test:dashboard
npm run lint
npm run dashboard:build
npm run audit:production
npm run test:layout
npm run test:visual
```

Pull requests should explain the user-visible outcome, verification performed,
and any privacy, sync, desktop, or release impact. Do not commit `.env` files,
credentials, generated installers, or local user configuration.

By participating, you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).
Report vulnerabilities through [the private security process](SECURITY.md).
