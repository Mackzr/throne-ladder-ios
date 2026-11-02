# Throne Ladder iPhone builds (TestFlight)

Windows cannot finish an iPhone app, so a Mac in GitHub Actions does it:

1. Unity exports the Xcode project: menu Throne Ladder > Build iPhone (Xcode project), or with the project closed
   `Unity.exe -batchmode -projectPath <unity> -buildTarget iOS -executeMethod ThroneLadder.Client.Editor.IosBuild.Build`
   (output `builds/ios-xcode`; the icon, launch picture, encryption flag and team K955P6369G are set there).
2. `REPO=<owner>/throne-ladder-ios bash ios-ci/publish.sh "what changed"` zips it and publishes a release of the private
   repository `throne-ladder-ios` (this folder is its content).
3. The release starts `.github/workflows/testflight.yml` on `macos-15`: Xcode archives with automatic signing through the
   App Store Connect key (Admin role), sets the build number to the run number, exports and uploads to App Store
   Connect. TestFlight processes it (about 10-30 minutes) and offers it to the internal testers.

Secrets on the repository (set by the owner, never seen by Claude): `ASC_KEY_P8` (the AuthKey_*.p8 file's text),
`ASC_KEY_ID`, `ASC_ISSUER_ID`. App ID `com.sullifishstudios.throneladder`.
