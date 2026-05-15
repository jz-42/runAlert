# runAlert Execution Plan

## Launch Goal

Ship a public beta that is honest, usable, and narrow:

- `runalert.app` is the public front door
- desktop is the real product
- Mac is the primary launch platform
- Windows is a stretch-parity platform, not the core launch dependency
- browser alerts stay a lightweight demo, not the main promise

## Ship Decision Checklist

Ship publicly only if all are true:

- [ ] live Mac download serves the current build
- [ ] clean Mac install works from the real `runalert.app` flow
- [ ] packaged desktop alerts work well enough for beta
- [ ] quiet hours behave correctly in the packaged app
- [ ] background monitoring feels understandable and sane
- [ ] no major onboarding/install confusion remains
- [ ] trust/security explanation is clear and honest
- [ ] Reddit/public copy is honest about beta status and current limitations

## Current Reality

Done:

- web + desktop beta product exists
- Twitch-live semantics are fixed
- custom drag/reorder polish landed
- desktop notification actions are explicit (`Open Stream` / `Dismiss`)
- background-monitoring UX and onboarding direction are implemented
- Mac guide was tightened around trust + Gatekeeper flow
- fresh Mac `.dmg` / `.zip` artifacts were built
- GitHub beta release `v0.1.0-beta.2` was refreshed
- live Mac download endpoints now point at the refreshed release assets
- hosted config persistence was hardened so Supabase-backed token configs are
  auto-detected when env vars are present

Still open:

- final real Mac beta sanity pass from the live site
- verify production hosted config persistence is actually using Supabase envs
- Windows installer must be built on the real Windows laptop
- Windows download activation + smoke test
- final trust/release/Reddit copy pass

## Trust And Security

There are two audiences:

- beginner users who want a simple reason this is not sketchy
- technical users who want a concrete way to verify the release

What we can truthfully say:

- code is public in `jz-42/runAlert`
- no account is required
- desktop config is local for beta
- the app has a narrow scope:
  streamer monitoring, Twitch-live checks, milestones, alerts
- GitHub release checksums are published for the Mac build
- the current Mac build is unsigned, so macOS may show a warning

What we should not say:

- that unsigned means unsafe
- that AI review “proves” safety
- that public source alone guarantees safety
- that the app is signed/notarized if it is not

Trust path for beginner users:

- explain what the app does
- explain what stays local
- explain that no account is needed
- explain the Mac warning in plain English

Trust path for technical users:

- public repo
- public GitHub release
- checksums
- optional AI-assisted repo/file sanity check

## Remaining Launch Order

### 1. Confirm Hosted Config Persistence

Goal: make sure web users do not lose token-based config on Render redeploys.

Tasks:

- [ ] Check Render env vars:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - optional `SUPABASE_CONFIG_TABLE`
- [ ] Confirm the `runalert_configs` table exists in Supabase
- [ ] Verify a browser config survives a redeploy/restart

Important note:

- code is now hardened to auto-use Supabase when those env vars are present
- if those env vars are missing, hosted token configs can still reset

### 2. Final Mac Sanity Pass

Goal: verify the real public Mac path one last time before public posting.

Tasks:

- [ ] Download from `runalert.app`
- [ ] Install from the refreshed live artifact
- [ ] Verify:
  - app opens
  - add/edit streamer flow feels fine
  - Twitch live dot behavior looks right
  - one real alert path works
  - quiet hours suppress correctly
  - background monitoring on/off feels sane
  - quit behavior with background monitoring on is understandable

### 3. Windows Build On The Windows Laptop

Goal: produce and validate a real Windows installer.

Important reality:

- the Mac cross-build path fails in Wine during Windows packaging
- the correct path is to build on the actual Windows laptop

Tasks on Windows:

- [ ] `git pull`
- [ ] `npm ci`
- [ ] `npm --prefix dashboard ci`
- [ ] `npm run electron:pack:win`
- [ ] confirm a real `.exe` lands in `dist-app`

Signing:

- [ ] not required for beta launch
- [ ] expect SmartScreen / unknown publisher friction until later

### 4. Windows Download Activation

Goal: make the Windows download real if the Windows build succeeds.

Tasks:

- [ ] upload the Windows `.exe` to the GitHub beta release
- [ ] set `RUNALERT_WINDOWS_EXE_URL` in Render
- [ ] verify `/download/windows/exe`

### 5. Windows Smoke Test

Goal: confirm Windows is usable enough for beta.

Tasks:

- [ ] install app
- [ ] open app
- [ ] add streamer
- [ ] test one alert path
- [ ] sanity check notifications + quiet hours
- [ ] record any installer or SmartScreen friction

### 6. Launch Copy And Public Post

Goal: make the public explanation honest and low-friction.

Tasks:

- [ ] final trust/safety note on the site/install flow
- [ ] final release notes are understandable to non-devs
- [ ] Reddit post explains:
  - this is a beta
  - Mac-first
  - no account required
  - source is public
  - current Mac build is unsigned

## Not A Blocker Today

Do not let these delay the beta:

- Apple signing/notarization
- Windows code signing
- metrics cleanup
- update-awareness UI
- broad visual redesign

## Useful Commands

Local verification:

```bash
cd /Users/JerryZhan/runAlert
npm test -- test/backend/api_server.test.mjs
npm --prefix dashboard test -- src/App.test.tsx
npm run dashboard:build
npm run electron:pack:mac
```

Live checks:

```bash
curl -I https://runalert.app/download/macos/dmg
curl -I https://runalert.app/download/macos/zip
curl -I https://runalert.app/download/windows/exe
```

Windows build:

```bash
git pull
npm ci
npm --prefix dashboard ci
npm run electron:pack:win
```

## Non-Negotiables

Be explicit about these:

- this is a beta
- browser alerts require the tab to stay open
- desktop is the durable experience
- desktop config is local for beta
- Twitch live means Twitch live
- the current Mac build is unsigned unless signing/notarization is later added

Do not claim these:

- Windows is ready before it is actually built and smoke-tested
- AI review guarantees safety
- the Mac build is signed/notarized if it is not
- background monitoring survives a full quit unless that behavior is verified
