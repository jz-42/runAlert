# Privacy

runAlert is designed to work without an identity account.

## Data stored for sync

- The streamers, milestone thresholds, quiet hours, and notification preferences
  you choose.
- Random account/device identifiers, keyed credential hashes, configuration
  revision numbers, and operational timestamps.
- Short-lived pairing exchange hashes until they expire or are consumed.

runAlert does not need your name, email address, password, postal address, or
payment information. Permanent device credentials are generated locally and are
never placed in a query string or pairing link.

## Local data

The browser keeps its device credential, current configuration, and pending
offline edit in that browser's local storage. The desktop app keeps configuration
in its application-data directory and encrypts its device credential using the
operating system through Electron `safeStorage`. A JSON export contains your
alert settings but not your device credential.

## Service providers

- Supabase stores durable synced settings and credential hashes.
- Render hosts the web/API service.
- Paceman supplies public Minecraft speedrun state.
- Twitch may supply public live-channel status.
- Optional, explicitly configured analytics providers receive sanitized product
  events; credentials, pairing secrets, URL queries, and streamer names are
  removed before transmission.

## Control and recovery

You can change or export settings at any time. Because there is no identity
account, recovery is performed by pairing an existing device or importing a
previous JSON export. Removing site/app data removes that device's local copy and
credential; uninstall behavior is verified during each release qualification.

This document describes the application behavior. A production operator should
publish contact and retention details appropriate to the deployed jurisdiction
before launch.
