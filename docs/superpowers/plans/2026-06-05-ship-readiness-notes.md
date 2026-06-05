## Ship Readiness Notes — 2026-06-05

### Hosted settings persistence

- Browser users do not persist streamer/settings config in frontend localStorage.
- The browser keeps a stable token locally, and the server stores config by that token.
- The hosted browser app saves per-user config by `token`.
- In production, those token configs must be stored in Supabase.
- If Supabase is not active, the server falls back to writing `configs/<token>.json` on disk.
- On Render, that fallback is not durable across deploys, so users appear to "reset" after each rollout.

### Required production check

- Verify Render has these env vars set and working:
  - `RUNALERT_CONFIG_STORE=supabase` or valid Supabase envs present
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_CONFIG_TABLE`
- Verify with the same browser:
  1. Save a config on `runalert.app`
  2. Redeploy Render
  3. Reload `runalert.app`
  4. Confirm the same token still loads the saved config

### Surface rules

- Browser/web version:
  - show browser alerts
  - show download/install CTA
  - hide background monitoring
- Desktop app:
  - show background monitoring
  - hide browser download/install CTA

### Background monitoring follow-up

- UI/config path is implemented and tested.
- Real desktop behavior still needs packaged-app verification:
  - persists after reopen
  - login-item behavior is correct
  - quit prompt is correct
  - background alerts still function
