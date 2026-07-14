# Security policy

## Supported versions

Security updates are provided for the current 1.x release line. Pre-release and
locally modified builds are not supported.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's **Security** tab and select
**Report a vulnerability** to create a private security advisory for this
repository. Include the affected version, reproduction steps, expected impact,
and any suggested mitigation.

You should receive an acknowledgement within seven days. Please allow time for a
fix and coordinated release before disclosing the issue publicly.

## Security boundaries

- Browser and desktop sync use random bearer credentials; only keyed hashes are
  stored server-side.
- Pairing exchanges are single-use and expire after ten minutes.
- The Electron renderer is sandboxed, context-isolated, and denied arbitrary
  navigation or window creation.
- Production sync requires Supabase and fails closed when its durable store is
  unavailable.
- Logs and analytics must not contain credentials, pairing secrets, query
  strings, or tracked streamer names.
