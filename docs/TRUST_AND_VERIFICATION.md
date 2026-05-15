# runAlert Trust And Verification

This is the short version of how to talk about trust during the beta launch.

## For Normal Users

The important facts are:

- runAlert is a small utility app
- no account is required
- desktop config stays local for beta use
- the code is public
- the current Mac build is unsigned, so macOS may show an extra warning

Do not overcomplicate this. Normal users do not need a deep security lecture.

## For Technical Users

Technical users should be able to verify:

- the repo is public: `jz-42/runAlert`
- the download comes from `runalert.app` and GitHub release assets
- the release notes include checksums
- the downloaded file matches the published checksum

Optional:

- users can inspect the repo themselves
- users can ask their preferred AI to review the public repo and compare the
  downloaded file as an extra sanity check

## What We Should Say

- this is a beta
- the source is public
- no account is required
- the current Mac build is unsigned
- here is how to verify the release if you want to

## What We Should Not Say

- that AI review guarantees safety
- that unsigned means unsafe
- that public source alone proves safety
- that the app is signed/notarized if it is not

## Suggested Public Copy

Short version:

`runAlert is an open beta utility app for Minecraft speedrun alerts. No account required. The source is public, desktop config stays local for beta use, and the current Mac build is unsigned, so macOS may show an extra warning before opening it.`

Technical add-on:

`If you want to verify the release yourself, use the public GitHub repo, release notes, and published checksums.`
