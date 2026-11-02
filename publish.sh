#!/usr/bin/env bash
# Sends the iPhone build to TestFlight: zips the Xcode project Unity exported (builds/ios-xcode, from
# Editor/IosBuild.cs) and publishes it as a release of the private build repository; publishing starts the workflow
# (.github/workflows/testflight.yml) on GitHub's Mac, which signs and uploads it.
#   REPO=<owner>/throne-ladder-ios bash ios-ci/publish.sh ["what changed"]
set -euo pipefail
cd "$(dirname "$0")/.."
GH=/c/Users/ciara/Tools/gh/bin/gh.exe
REPO="${REPO:?REPO=<owner>/throne-ladder-ios}"
[ -f builds/ios-xcode/Info.plist ] || { echo "no Xcode project in builds/ios-xcode: run IosBuild first"; exit 1; }
rm -f builds/xcode.zip
/c/Windows/System32/tar.exe -a -c -f builds/xcode.zip -C builds/ios-xcode .
tag="build-$(date -u +%Y%m%d-%H%M)"
"$GH" release create "$tag" builds/xcode.zip -R "$REPO" --title "$tag" --notes "${1:-Throne Ladder iPhone build}"
echo "published $tag: the TestFlight run starts now ($("$GH" run list -R "$REPO" -L 1 --json url -q '.[0].url' 2>/dev/null || true))"
