#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Requires a real Mac with Xcode and XcodeGen. This project is UNBUILT on Windows." >&2
  exit 1
fi
command -v xcodegen >/dev/null || { echo "Install XcodeGen on this Mac first." >&2; exit 1; }
[[ -f RitmNative/WebAssets/asset-manifest.json ]] || { echo "Package reviewed web assets first." >&2; exit 1; }
xcodegen generate --spec project.yml
xcodebuild -project RitmNative.xcodeproj -scheme RitmNative -configuration Release \
  -sdk iphoneos -destination 'generic/platform=iOS' \
  -archivePath build/RitmNative.xcarchive \
  CODE_SIGNING_ALLOWED=NO CODE_SIGNING_REQUIRED=NO CODE_SIGN_IDENTITY= \
  archive
# An unsigned IPA is a packaging artifact, NOT an installable iPhone app.
mkdir -p build/unsigned/Payload
ditto build/RitmNative.xcarchive/Products/Applications/RitmNative.app build/unsigned/Payload/RitmNative.app
(cd build/unsigned && /usr/bin/zip -qry ../RitmNative-unsigned.ipa Payload)
echo "Unsigned artifacts: build/RitmNative.xcarchive and build/RitmNative-unsigned.ipa"
echo "Not installable until signed for your device with a valid Apple provisioning profile."
