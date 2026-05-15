# runAlert Launch Summary

Canonical plan: [docs/EXECUTION_PLAN.md](/Users/JerryZhan/runAlert/docs/EXECUTION_PLAN.md).

## What Must Happen Before A Public Post

1. confirm hosted browser config persistence
2. confirm basic analytics are live
3. run final Mac sanity pass
4. build Windows installer on the Windows laptop
5. activate Windows download if that succeeds
6. run Windows smoke test
7. finalize public-post trust copy

Public-post rule:

- if Mac is clean and metrics are live, a Mac-first beta post is acceptable
- if Windows is not done, say that plainly and do not overclaim parity

## Concrete Phases

### Phase 1: Hosted State + Metrics

Estimated time: `20-40 min`

- confirm Supabase envs/table
- verify browser config survives redeploy
- confirm PostHog envs
- verify one or two real analytics events arrive

### Phase 2: Final Mac Sanity

Estimated time: `30-60 min`

- real-site download
- install
- alert / quiet-hours / background-monitoring sanity
- ship only if there is no blocker in install or alert flow

### Phase 3: Windows Build + Activation

Estimated time: `50-100 min`

- build on the Windows laptop
- upload `.exe`
- set Render Windows URL
- verify download
- smoke test installer/app
- if this slips, keep public framing Mac-first

### Phase 4: Final Public Copy

Estimated time: `20-30 min`

- release notes
- Reddit/public post
- trust/safety framing

## Deferred On Purpose

- Apple signing/notarization
- Windows code signing
- update-awareness UI
- deeper analytics cleanup beyond basic launch visibility
- extra non-blocking polish

## Launch Truths

- Mac is primary
- Windows is secondary until the laptop build and smoke test are done
- metrics should be live before the public post
- signing/notarization are not same-day blockers
