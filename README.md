# iPhone builds to TestFlight

Windows cannot finish an iPhone app, so a Mac in GitHub Actions does it:

1. Unity exports the Xcode project (`builds/ios-xcode`; the icon, launch picture, encryption flag and team K955P6369G
   are set there).
2. `REPO=<owner>/<this repository> bash ios-ci/publish.sh "what changed"` zips it, attaches it to a **draft** release of
   this repository and starts `.github/workflows/testflight.yml` with its tag.
3. On `macos-15`, Xcode archives it, signs it for the App Store through the App Store Connect key (Admin role), sets the
   build number to the run number, exports and uploads it. TestFlight processes it (about 10 to 30 minutes) and offers it
   to the internal testers. The draft and its tag are then deleted.

This repository is public (GitHub Actions is free on public repositories) and holds nothing of the game: the builds
only ever sit in draft releases, which the public cannot see, and each is deleted once it is on TestFlight; no artifact
is stored; the run's logs show no secret. Only people with write access can start a run.

Secrets on the repository (set by the owner, never seen by an agent, never shown in a log): `ASC_KEY_P8` (the
AuthKey_*.p8 file's text), `ASC_KEY_ID`, `ASC_ISSUER_ID`.
