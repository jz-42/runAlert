# runAlert Launch Runbook

Use this after the current deploy finishes.

## 1. Hosted Config Persistence

In Render, confirm these env vars exist if hosted browser config should survive
redeploys:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- optional `SUPABASE_CONFIG_TABLE`

In Supabase, confirm this table exists:

```sql
create table if not exists runalert_configs (
  token text primary key,
  config jsonb not null,
  updated_at timestamptz not null default now()
);
```

## 2. Basic Analytics

In Render, confirm:

- `VITE_POSTHOG_KEY`
- optional `VITE_POSTHOG_HOST`

Then verify at least one live event lands:

1. open the live site
2. click a download button
3. add a streamer
4. confirm those events appear in PostHog

## 3. Final Mac Sanity Pass

From the live site:

1. open `runalert.app`
2. open the Mac install guide
3. download the DMG
4. install the app
5. open the app and sanity check:
   - add streamer flow
   - live dot behavior
   - one alert path
   - quiet hours
   - background monitoring
   - quit behavior

## 4. Windows Build

On the Windows laptop:

```bash
git pull
npm ci
npm --prefix dashboard ci
npm run electron:pack:win
```

Expected result:

- a Windows installer `.exe` in `dist-app`

## 5. Windows Download Activation

If the Windows build succeeds:

1. upload the `.exe` to the GitHub beta release
2. set `RUNALERT_WINDOWS_EXE_URL` in Render
3. verify:

```bash
curl -I https://runalert.app/download/windows/exe
```

## 6. Windows Smoke Test

On the Windows laptop:

1. install app
2. open app
3. add streamer
4. test one alert path
5. sanity check notifications and quiet hours
6. note any SmartScreen or installer friction

## 7. Public Launch Decision

Ship if:

- Mac path is clean
- hosted config persistence is confirmed
- analytics are live enough to observe launch traffic
- Windows is either verified enough for beta or clearly labeled as secondary
- trust copy is honest

Public framing:

- safest same-day framing is `public beta`, `Mac-first`
- only mention Windows as available if the Windows build and smoke test are done

Hold if:

- live Mac flow still has confusing friction
- hosted browser config is still resetting unexpectedly
- Windows path is broken and the public messaging would overclaim parity
