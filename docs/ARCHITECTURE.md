# Architecture

## Runtime surfaces

runAlert has one React dashboard and two host environments:

- **Web:** the browser talks directly to the public Express API.
- **Desktop:** Electron serves the built dashboard from a dynamic loopback port.
  The sandboxed renderer talks through a narrow preload bridge; the main process
  owns credential encryption, deep links, updates, external navigation, the tray,
  the watcher, and shutdown.

The watcher reads the same validated configuration, polls run data, deduplicates
milestones, and dispatches native notifications. Paceman supplies run state;
Twitch status is optional enrichment.

## Anonymous sync

`POST /api/devices` creates a logical account, its initial configuration, and a
device credential. Supabase stores the configuration separately from devices and
only stores a keyed hash of each credential. All later config calls use an
`Authorization: Bearer` header.

Each configuration is an envelope:

```json
{
  "schemaVersion": 1,
  "revision": 4,
  "updatedAt": "2026-07-14T00:00:00.000Z",
  "config": {}
}
```

Writes must send the current revision in both `If-Match` and
`expectedRevision`. A stale write receives `409` and the current server envelope;
the client asks which version to keep. Authenticated server-sent events announce
new revisions, while periodic refresh provides a reconnect fallback. Offline
edits remain queued locally until a safe write is possible.

Pairing creates one short-lived exchange with independently hashed deep-link and
manual-code secrets. Consuming either secret once creates a new credential for
the same logical account.

## Trust boundaries

- Supabase service credentials exist only on the server.
- Browser credentials stay in local storage. Desktop credentials are encrypted
  through Electron `safeStorage`; sync state and user config are separate files.
- The renderer has no Node integration and cannot navigate away from its exact
  origin. Only allowlisted HTTPS hosts may open externally.
- The production API applies body limits, schema validation, throttling, security
  headers, credential-safe logging, and readiness checks.
- Production config sync never falls back to a local/ephemeral file store.

## Deployment and release

Render builds the API and dashboard from `main` using Node 24 and checks
`/health`. Mac CI produces a signed, hardened, notarized, stapled universal DMG
and ZIP. Windows CI produces an x64 AppX using the identity assigned by Partner
Center; Microsoft Store certification/signing and updates remain Store-managed.
`GET /api/releases/stable` is the website's source of truth for availability.
