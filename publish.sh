#!/usr/bin/env bash
# Sends the iPhone build to TestFlight: zips the Xcode project Unity exported (builds/ios-xcode, from
# Editor/IosBuild.cs), attaches it to a DRAFT release of the build repository (drafts are never public: the repository
# is public since 8 Nov 2026, for GitHub Actions' free Mac minutes) and starts the workflow
# (.github/workflows/testflight.yml) on GitHub's Mac with that tag; it signs and uploads the build, then deletes the
# draft and its tag, so nothing of the game stays in the repository.
#   REPO=<owner>/<build repository> bash ios-ci/publish.sh ["what changed"]
set -euo pipefail
cd "$(dirname "$0")/.."
GH=/c/Users/ciara/Tools/gh/bin/gh.exe
REPO="${REPO:?REPO=<owner>/<build repository>}"
[ -f builds/ios-xcode/Info.plist ] || { echo "no Xcode project in builds/ios-xcode: run IosBuild first"; exit 1; }
rm -f builds/xcode.zip
/c/Windows/System32/tar.exe -a -c -f builds/xcode.zip -C builds/ios-xcode .
tag="build-$(date -u +%Y%m%d-%H%M)"
"$GH" release create "$tag" builds/xcode.zip -R "$REPO" --title "$tag" --notes "${1:-Simple Colonies iPhone build}" --draft > /dev/null
"$GH" workflow run testflight.yml -R "$REPO" -f tag="$tag"
# the run for this build (its title is "TestFlight <tag>"): wait up to a minute for it to appear
run=""
for i in $(seq 1 30); do
  run=$("$GH" run list -R "$REPO" -L 5 --json url,displayTitle -q ".[] | select(.displayTitle == \"TestFlight $tag\") | .url" 2>/dev/null | head -1)
  [ -n "$run" ] && break
  sleep 2
done
echo "published $tag (a draft): the TestFlight run starts now (${run:-not listed yet: gh run list -R $REPO})"
