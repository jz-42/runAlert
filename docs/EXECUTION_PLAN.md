# runAlert Execution Plan

## Launch Goal

Ship a public beta that is honest, usable, and narrow:

- `runalert.app` is the public front door
- desktop is the real product
- Mac is the primary launch platform
- Windows is secondary but should be tested if time allows
- browser alerts remain a lightweight demo, not the main promise

## Before Public Posting

Do not post publicly until all of these are done:

- [ ] Mac notarization is confirmed and the signed/notarized build is published
- [ ] hosted browser config persistence is confirmed
- [ ] basic analytics are live and verified
- [ ] live Mac install flow is sanity-checked from the real site
- [ ] packaged alerts + quiet hours are sanity-checked
- [ ] background monitoring is sanity-checked
- [ ] trust/safety language is finalized
- [ ] Windows is either tested enough for beta or clearly framed as secondary

Public-post rule:

- if Mac is clean and metrics are live, a Mac-first beta post is acceptable
- do not claim Windows support unless the Windows build and smoke test are done

## Current Reality

Done:

- live Mac download is refreshed and points at the new release assets
- Mac install guide/trust flow is improved
- background-monitoring UX is implemented
- hosted config persistence is hardened in code:
  Supabase-backed token configs auto-enable when env vars are present
- dashboard analytics wiring already exists in code
- Developer ID signing is working for the packaged Mac app

Still open:

- let the current notarization run finish and verify it
- publish the signed/notarized Mac assets
- verify production Supabase envs/table
- verify production analytics envs and event flow
- final Mac live sanity pass
- build Windows installer on the Windows laptop
- activate Windows download if that build succeeds
- final public-post / release / trust copy

## Phased Plan

### Phase 1: Mac Signing, Notarization, And Release Refresh

Estimated time: `15-45 min`

Goal: finish the Apple trust path and make sure the files users download are the new trusted ones.

Tasks:

- [ ] let the current `notarytool` submission finish
- [ ] verify:
  - `xcrun stapler validate "dist-app/mac-arm64/runAlert.app"`
  - `spctl --assess --type execute --verbose "dist-app/mac-arm64/runAlert.app"`
- [ ] upload the new signed/notarized Mac DMG + ZIP release assets
- [ ] update public/install wording that still says the Mac build is unsigned

Why this is before public posting:

- signing is already working
- the user-facing trust win is not complete until notarization is verified and the public assets are refreshed

### Phase 2: Hosted State And Metrics

Estimated time: `20-40 min`

Goal: make sure the public site preserves user config and records basic launch
signals before traffic arrives.

Tasks:

- [ ] In Render, confirm:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - optional `SUPABASE_CONFIG_TABLE`
- [ ] In Supabase, confirm the `runalert_configs` table exists
- [ ] Verify a browser config survives a Render redeploy/restart
- [ ] In Render, set:
  - `VITE_POSTHOG_KEY`
  - optional `VITE_POSTHOG_HOST`
- [ ] Verify at least one live analytics event arrives:
  - page open
  - download click
  - streamer add

Why this is before public posting:

- if config resets, the web experience feels broken
- if analytics are absent, you lose the first real launch signal

### Phase 3: Final Mac Sanity

Estimated time: `30-60 min`

Goal: verify the real public Mac path one last time.

Tasks:

- [ ] open `runalert.app`
- [ ] open the Mac install guide
- [ ] download the DMG
- [ ] install the app
- [ ] verify:
  - add/edit streamer flow
  - Twitch live dot behavior
  - one alert path
  - quiet hours
  - background monitoring
  - quit behavior

Ship threshold for this phase:

- no blocker in install flow
- no blocker in alert flow
- no confusing background-monitoring failure

### Phase 4: Windows Build

Estimated time: `30-60 min`

Goal: produce a real Windows installer.

Important reality:

- the Mac cross-build path fails in Wine
- the real build should happen on the Windows laptop

Tasks on Windows:

- [ ] `git pull`
- [ ] `npm ci`
- [ ] `npm --prefix dashboard ci`
- [ ] `npm run electron:pack:win`
- [ ] confirm a real `.exe` appears in `dist-app`

Signing:

- [ ] not required for beta launch
- [ ] expect SmartScreen / unknown publisher friction until later

### Phase 5: Windows Activation And Smoke Test

Estimated time: `20-40 min`

Goal: make Windows real enough to mention publicly.

Tasks:

- [ ] upload the Windows `.exe` to the GitHub beta release
- [ ] set `RUNALERT_WINDOWS_EXE_URL` in Render
- [ ] verify `/download/windows/exe`
- [ ] install on the Windows laptop
- [ ] sanity check:
  - app opens
  - add streamer
  - one alert path
  - notifications
  - quiet hours

Fallback:

- if Windows build or smoke test slips, ship publicly as Mac-first beta and say
  Windows is still being validated

### Phase 6: Final Trust And Public Copy

Estimated time: `20-30 min`

Goal: make the public explanation honest and low-friction.

Tasks:

- [ ] finalize release notes
- [ ] finalize Reddit/public post copy
- [ ] make sure the post says:
  - beta
  - Mac-first
  - no account required
  - source is public
  - Mac build is signed/notarized if Phase 1 succeeded
  - Windows status is accurate

## Deferred On Purpose

Not required before the public beta post:

- Windows code signing
- update-awareness UI
- deeper analytics cleanup beyond basic live verification
- extra UI polish beyond blocker fixes
- broader metrics dashboards or funnels

## Trust And Security

There are two audiences:

- beginner users who want a simple reason this is not sketchy
- technical users who want a way to verify the release

For beginner users:

- explain what the app does
- explain what stays local
- explain that no account is required
- explain the current Mac security state in plain English

For technical users:

- public repo
- public release
- checksums
- optional AI-assisted sanity check

Do not say:

- that AI review guarantees safety
- that unsigned means unsafe
- that the app is notarized until verification confirms it
- that the app is signed/notarized if it is not

## Parallel Work

Allowed in parallel:

- minor Claude UI/visual polish that does not change launch-critical behavior

Do not let parallel polish block:

- notarization completion
- hosted config persistence
- metrics verification
- release asset refresh

## Useful Commands

Local:

```bash
cd /Users/JerryZhan/runAlert
npm test -- test/backend/api_server.test.mjs
npm --prefix dashboard test -- src/App.test.tsx
npm run dashboard:build
npm run electron:pack:mac
```

Live:

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
