# Autosave And Persistence Redesign

## Goal

Make settings and data entry across the dashboard behave like a modern app:

- edits feel immediate
- successful saves are silent
- fast repeated edits do not get lost
- closing a modal does not lose pending work
- failures are subtle but clear
- the architecture is reusable across the site instead of being one-off logic per control

This is a long-term persistence design, not a patch to the current milestone modal autosave.

## Current Problems

The current milestone editing flow mixes:

- local modal draft state
- a debounce timer
- a manual save button
- in-flight request state
- re-hydration from `cfg`

That combination creates race conditions:

- a user can edit quickly and close or move on before the latest change is truly saved
- older responses can conceptually compete with newer user intent
- UI can temporarily look correct while persistence is not yet reliable
- reopening an editor can show older confirmed data rather than the user's most recent attempted changes

The visible `Saving...` button state is also doing too much. It acts as both a status indicator and a manual fallback, which makes the UX feel less like a normal settings app.

## Product Decisions

### Saving Model

- Autosave is the primary persistence model everywhere.
- Manual save remains as a secondary `Save now` fallback during the transition.
- Successful saves are silent.
- Errors are local to the affected surface and subtle, but clear.

### Save Timing

- Discrete actions save immediately:
  - toggles
  - add/remove streamer
  - add/remove quiet hours
  - add/remove similar list items
- Typed inputs save with short debounce plus blur flush:
  - milestone minute/second fields
  - future text or numeric entry fields

`Blur flush` means: when the user clicks away, tabs away, or otherwise leaves the field, pending debounced changes save immediately instead of waiting for the timer.

### Conflict Resolution

- Latest user intent always wins.
- If the user toggles on, then off, before the first request finishes, the final persisted state must be `off`.
- Older network responses must never overwrite newer local intent.

### Failure Behavior

- On save failure, revert the affected surface to the last confirmed saved state.
- Show a subtle local error with a retry path.
- Do not keep unsaved attempted edits around after failure.

### Modal Behavior

- Closing a modal should be immediate.
- Pending saves continue in the background.
- Save behavior must not depend on modal-local component lifetime.

## Recommended Architecture

Build a shared client-side persistence layer for editable settings surfaces.

That layer owns the save mechanics. UI components only describe what changed.

### Core Concepts

#### Confirmed State

The last value the server has definitely accepted.

Example:
- milestone is confirmed on the server as `4:30`

#### Optimistic State

The value the UI shows immediately while save is pending.

Example:
- user changes milestone to `4:20`
- UI shows `4:20` right away
- server has not confirmed it yet

#### Pending Save

A request currently being sent to the server.

Example:
- the app is saving `4:20`

#### Latest Intent

The newest state the user wants, even if an older request is still running.

Example:
- app starts saving `4:20`
- before it finishes, user changes to `4:10`
- `4:10` is now the latest intent and must win

#### Versioning

Each save attempt gets a version number. When a response comes back, the app only accepts it if it matches the newest relevant version.

Example:
- save v1 sends `4:20`
- save v2 sends `4:10`
- v1 finishes after v2
- app ignores v1 because it is stale

This is the main protection against "it looked saved but actually reverted later."

## Proposed Shape

Introduce a reusable persistence primitive, likely a hook plus helper layer, that each editable surface can use.

Each surface tracks:

- `confirmedValue`
- `optimisticValue`
- `saveState`
  - `clean`
  - `dirty`
  - `saving`
  - `error`
- `inFlightVersion`
- `latestVersion`
- `queuedIntent` or equivalent coalesced next state

The layer provides operations like:

- `applyOptimisticChange(updater)`
- `scheduleSave()`
- `flushNow()`
- `rollbackToConfirmed()`
- `retryLastIntent()`

Exact naming can change, but the behavior should stay the same.

## Data Flow

### Immediate Toggle Example

User toggles a milestone enabled state:

1. UI updates immediately.
2. Persistence layer records new optimistic value.
3. Save request starts immediately.
4. If it succeeds:
   - confirmed state becomes the new value
   - UI stays as-is
   - no success message needed
5. If it fails:
   - UI reverts to last confirmed value
   - local subtle error appears

### Typed Input Example

User edits `4:30` to `4:10`:

1. Each keystroke updates optimistic UI immediately.
2. Debounce timer delays network save briefly.
3. If user stops typing, save begins.
4. If user clicks away first, save flushes immediately.
5. If a second edit happens while the first save is in flight:
   - latest intent is stored
   - stale response is ignored
   - newest value is eventually persisted

### Close Modal Example

User edits a field and closes the modal immediately:

1. Modal closes without blocking.
2. Persistence layer still exists outside the modal lifecycle.
3. Pending save finishes in background.
4. If save succeeds, nothing special happens.
5. If save fails, the next relevant surface shows a subtle local error and the confirmed value remains authoritative.

## Scope Of First Implementation

The first implementation should build the shared persistence architecture, then migrate the highest-risk surfaces first:

1. Streamer milestone modal
2. Quiet hours editor
3. Notification/settings toggles
4. Add/remove streamer flows

This is still one cohesive project, but the migration order should favor surfaces most exposed to rapid edits and modal-close timing.

## UX Changes

### Keep

- fast immediate-feeling interactions
- a secondary manual `Save now` fallback during transition

### Remove Or Reduce

- button-centered `Saving...` feedback on ordinary edits
- dependence on manual save for correctness
- save logic embedded separately inside individual controls

### Show Only When Needed

- local error on failure
- retry affordance on failure

No routine "Saved" toast or status text is required for successful edits.

## Testing Strategy

This redesign requires stronger behavior tests than the current happy-path suite.

### Required Cases

- fast toggle on/off/on with out-of-order responses
- multiple edits while one save is in flight
- debounce save after typing pause
- blur flush after typing
- close modal immediately after edit
- failure rollback to confirmed state
- retry after failure
- reopen after success
- reopen after failure
- optimistic UI never left in false-success state

### Test Levels

- unit tests for the shared persistence primitive
- component tests for migrated surfaces
- targeted integration tests for modal close, race conditions, and rollback behavior

## Why This Is The Long-Term Fix

The real bug is not "the debounce is a little off." The real bug is that save ownership is fragmented and timing-sensitive.

This design fixes that by separating three things clearly:

- what the server has confirmed
- what the user currently wants
- what requests are still unresolved

Once those are distinct, the UI can be fast without lying, and the save behavior can be reused site-wide.

## Risks

- Migrating save behavior without a shared abstraction would recreate the current problem in new places.
- A too-small patch would improve one modal while leaving the architecture inconsistent.
- A too-large full-state rewrite would add unnecessary churn before proving the persistence model.

The recommended middle path is:

- one robust shared persistence layer
- incremental migration onto that layer
- strong race-condition tests before expanding further

## Success Criteria

- Users no longer need to pause and wait for settings changes to "really stick."
- Reopening a surface reliably reflects last confirmed saved state.
- Fast repeated edits persist the newest intended value.
- Modal close does not lose work.
- Failures are recoverable and local.
- The same persistence model can be reused across the site.
