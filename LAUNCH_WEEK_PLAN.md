# runAlert Launch Summary

Canonical plan: [docs/EXECUTION_PLAN.md](/Users/JerryZhan/runAlert/docs/EXECUTION_PLAN.md).

## Where We Are

Launch work is now mostly ops + validation, not product design.

Done:

- live Mac download is refreshed
- Mac trust/install guide is improved
- background-monitoring product story is defined
- hosted config persistence was hardened in code

Open:

- confirm production Supabase config persistence envs
- final Mac sanity pass from the real site
- build Windows installer on the Windows laptop
- activate Windows download if the build succeeds
- final public-post trust copy

## Ship Checklist

- [ ] Mac live download is current
- [ ] Mac install flow works end-to-end
- [ ] packaged alerts behave well enough for beta
- [ ] quiet hours behave well enough for beta
- [ ] background monitoring is understandable and sane
- [ ] hosted browser config persistence is confirmed
- [ ] trust/safety message is simple and honest

## Next Order

1. confirm Supabase config persistence on Render
2. run final Mac sanity pass
3. build Windows installer on the Windows laptop
4. activate Windows download if that build succeeds
5. run Windows smoke test
6. finalize launch / Reddit copy

## Trust Reminder

For beginner users:

- explain what the app does
- explain that no account is required
- explain what stays local
- explain the unsigned Mac warning honestly

For technical users:

- public repo
- public release
- checksums
- optional AI-assisted sanity check

## Not Today

- signing / notarization
- full Windows polish beyond smoke testing
- metrics cleanup
- update-awareness UI
