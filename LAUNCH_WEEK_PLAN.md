# runAlert Launch Week Plan

Canonical technical plan: [docs/EXECUTION_PLAN.md](/Users/JerryZhan/runAlert/docs/EXECUTION_PLAN.md)

## Ship Goal

Ship an honest public beta that is:

- Mac-first
- desktop-first
- transparent about trust and beta friction
- narrow enough to verify in one launch-day window

## What We Achieved Today

- pushed the latest source changes to `main`
- refreshed the live Mac download assets and verified the public download URLs
- improved the Mac install guide and trust/security messaging
- added the full Windows install walkthrough with placeholder screenshots
- implemented background-monitoring UX and quit handling
- hardened hosted config persistence in code so Supabase auto-enables when the env vars exist
- confirmed analytics wiring already exists in the dashboard code
- simplified the Windows build into one laptop command:
  `npm run windows:beta:build`

## Critical Reality Checks

1. Hosted browser config is still broken in production until Render is actually using Supabase.
You just proved this by redeploying and losing saved streamers again.

2. This is not a missed push problem.
The code-side hardening is in `main`, but the production env/table still appear incomplete.

3. Local desktop config is a separate system.
The packaged desktop app stores config under the local Electron user-data directory, so a Render redeploy does not wipe desktop config.

4. Background Monitoring exists. Desktop auto-update does not.
There is an `agent.autoUpdate` setting for the watcher-script path, but there is no packaged Electron app auto-update system wired today.

5. Windows is optional for the public post only if we describe it honestly.
If the Windows build/smoke test slips, post as Mac-first beta.

## Public Post Gate

Do not post publicly until these are true:

- [ ] hosted browser config persistence is confirmed after a redeploy
- [ ] basic analytics are live and verified
- [ ] live Mac install flow is sanity-checked from the real site
- [ ] packaged alert flow is sanity-checked
- [ ] quiet hours are sanity-checked
- [ ] background monitoring is sanity-checked
- [ ] trust/safety language is finalized
- [ ] Windows is either tested enough for beta or clearly framed as secondary

## Recommended Order From Here

### Phase 1: Fix Hosted Browser Persistence

Estimated time: `25-45 min`

Why first:

- the public web app feels broken if saved streamer config disappears on redeploy
- you already reproduced this today

Tasks:

- [ ] in Render, confirm:
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - optional `SUPABASE_CONFIG_TABLE`
- [ ] in Supabase, confirm the `runalert_configs` table exists
- [ ] create/update one browser config on the live site
- [ ] redeploy or restart once
- [ ] confirm the same config still exists afterward

Definition of done:

- a live web config survives a Render redeploy

### Phase 2: Turn On Basic Metrics

Estimated time: `10-20 min`

Why second:

- if launch traffic arrives before analytics are live, we lose the first useful signal

Tasks:

- [ ] in Render, confirm:
  - `VITE_POSTHOG_KEY`
  - optional `VITE_POSTHOG_HOST`
- [ ] verify at least these events arrive in PostHog:
  - page open
  - app download click
  - streamer add

Definition of done:

- at least one real session shows up with real launch events

### Phase 3: Final Mac Sanity

Estimated time: `30-45 min`

Why third:

- Mac is the actual launch platform
- the app download/tutorial flow is already much closer than the hosted web-config path

Tasks:

- [ ] open `runalert.app`
- [ ] open the Mac install guide
- [ ] download the DMG from the real site
- [ ] install the app
- [ ] verify:
  - add/edit streamer flow
  - Twitch live dot sanity
  - one alert path
  - quiet hours
  - background monitoring
  - quit behavior

Definition of done:

- no blocker in install flow
- no blocker in alert flow
- no confusing background-monitoring behavior

### Phase 4: Windows Build And Smoke Test

Estimated time: `40-75 min`

Why fourth:

- valuable if it works
- not worth blocking the whole Mac-first launch before hosted persistence and metrics are fixed

Tasks:

- [ ] on the Windows laptop:
  - `git pull`
  - `npm run windows:beta:build`
- [ ] upload the new `.exe` to the GitHub beta release
- [ ] set `RUNALERT_WINDOWS_EXE_URL` in Render
- [ ] verify `/download/windows/exe`
- [ ] install once on Windows and sanity check:
  - app opens
  - add streamer
  - one alert path
  - notifications
  - quiet hours

Fallback:

- if this slips, ship publicly as `Mac-first beta` and say Windows is still being validated

### Phase 5: Final Public Copy And Ship Decision

Estimated time: `20-30 min`

Tasks:

- [ ] finalize release notes
- [ ] finalize Reddit/public post copy
- [ ] make sure public wording says:
  - beta
  - Mac-first
  - no account required
  - source code is public
  - current Mac build is unsigned
  - Windows status is accurate

## Security And Trust

There are two audiences:

- beginner users who want a simple reason this is not sketchy
- technical users who want a way to verify the release

Beginner trust path:

- no account required
- clear explanation of what the app does
- clear explanation of what stays local
- plain-English explanation of unsigned beta warnings

Technical trust path:

- public repo
- public release
- checksums
- optional AI-assisted sanity check

Important honesty rule:

- do not say AI review guarantees safety
- do not imply unsigned means unsafe
- do not imply the packaged desktop app auto-updates if it does not

## UI And Userflow Status

Handled already:

- Mac install guide/trust flow improved
- Windows install guide now matches the Mac structure
- background-monitoring UI is implemented
- download flow points at live GitHub release assets

Still worth a final pass, but not the first blocker:

- final human sanity pass on onboarding/install flow wording
- any small Claude polish that does not change behavior

## Deferred On Purpose

Not required before the public beta post:

- Apple signing/notarization
- Windows code signing
- packaged desktop auto-update
- deeper analytics dashboards/funnels
- update-awareness UI
- extra non-blocking visual polish
