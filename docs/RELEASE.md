# Release process

runAlert uses `dev` as the short pre-release checkpoint and `main` as the
production/default branch. Render deploys only `main`.

## 1. Qualify `dev`

Update `package.json`, `dashboard/package.json`, and `CHANGELOG.md` together.
Run the complete verification suite on Node 24.17.x:

```bash
npm ci
npm --prefix dashboard ci
npm run test:backend
npm run test:dashboard
npm run lint
npm run dashboard:build
npm run audit:production
npx --prefix dashboard playwright install chromium firefox
npm run test:layout
npm --prefix dashboard run test:a11y
npm run test:visual
node scripts/verify-release-version.mjs v1.0.0
```

Complete the secret scan and review the entire `origin/dev...HEAD` diff. Open a
`dev → main` release pull request and require green CI before merging.

## 2. Prepare distribution identities

Mac CI requires a valid Developer ID Application certificate plus either an App
Store Connect notary keychain profile or `APPLE_ID`,
`APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID`. Store the certificate as
`MAC_DEVELOPER_ID_CERTIFICATE` with its password in
`MAC_DEVELOPER_ID_CERTIFICATE_PASSWORD`.

Windows CI requires the Partner Center values assigned after reserving the app:
`RUNALERT_WINDOWS_IDENTITY_NAME`, `RUNALERT_WINDOWS_PUBLISHER`, and
`RUNALERT_WINDOWS_PUBLISHER_DISPLAY_NAME`.

These account agreements, identity reservations, and credentials are owner-only
external gates. Never commit their values.

## 3. Build and verify

Tag the merged production commit `v1.0.0`. The release workflow:

1. repeats tests, lint, build, audit, and version checks;
2. creates a universal Mac DMG/ZIP with mandatory signing and notarization;
3. verifies `codesign`, Gatekeeper, stapling, and both executable architectures;
4. creates and validates an x64 Microsoft Store AppX;
5. writes SHA-256 checksums and publishes the GitHub release only after both
   platform jobs succeed.

Submit the AppX to Partner Center and keep the GitHub release non-public until
Microsoft certification completes. Run every item in
[OWNER_DEVICE_CHECKLIST.md](OWNER_DEVICE_CHECKLIST.md).

## 4. Publish together

Set the production manifest variables to the GitHub DMG/ZIP URLs, certified
Microsoft Store listing, and publication timestamp. Deploy `main`, verify
`/health` and `GET /api/releases/stable`, publish the GitHub release and Store
listing together, then confirm `runalert.app` metadata and download controls.

After launch, fast-forward `dev` to the same production commit. Monitor sanitized
server errors, sync failures, Supabase usage, Render health, downloads, Store
certification/update state, and Mac updater failures.

## Rollback

If sync or the API is unhealthy, keep the durable schema intact, roll Render back
to the last known-good `main` deployment, and leave the manifest pointing only to
known-good artifacts. Never switch production sync to an ephemeral file store.
