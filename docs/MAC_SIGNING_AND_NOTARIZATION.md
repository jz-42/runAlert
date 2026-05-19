# Mac Signing And Notarization

This repo is wired for direct macOS distribution with:

- Developer ID Application signing
- hardened runtime
- notarization through `@electron/notarize`

## Recommended Setup

Prefer storing notarization credentials in the macOS Keychain with `notarytool`.

Example:

```bash
xcrun notarytool store-credentials "runalert-notary"
```

Then provide:

```bash
export APPLE_NOTARYTOOL_KEYCHAIN_PROFILE=runalert-notary
export APPLE_TEAM_ID=JV96FJ49AX
```

If you are not using a keychain profile, the notarization hook also supports:

```bash
export APPLE_ID="your-apple-id-email"
export APPLE_APP_SPECIFIC_PASSWORD="your-app-specific-password"
export APPLE_TEAM_ID=JV96FJ49AX
```

Do not commit secrets. Do not put secrets in `package.json`.

## Build

```bash
npm run electron:pack:mac
```

If a valid `Developer ID Application` identity is installed, electron-builder
should sign the app bundle before the notarization hook runs.

## Verify

Check signing identities:

```bash
security find-identity -v -p codesigning
```

Check the built app signature:

```bash
codesign --verify --deep --strict --verbose=2 "dist-app/runAlert.app"
```

Check Gatekeeper acceptance:

```bash
spctl --assess --type execute --verbose "dist-app/runAlert.app"
```

Check stapled notarization ticket:

```bash
xcrun stapler validate "dist-app/runAlert.app"
```

## Important Notes

- This repo currently supports notarizing the packaged macOS app.
- Windows signing is still separate and not configured here.
- Packaged desktop auto-update is not implemented by this setup.
