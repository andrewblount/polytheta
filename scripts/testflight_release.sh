#!/usr/bin/env bash
# Archive Polytheta for iOS and ship it to TestFlight — no cable, no Xcode GUI.
#
#   bash scripts/testflight_release.sh            # auto-increments build number
#   ASC_BUILD=12 bash scripts/testflight_release.sh
#
# Signing and upload authenticate with an App Store Connect API key, so this
# works headlessly (no Apple ID signed into Xcode). Requires in .env.local:
#   ASC_KEY_ID       e.g. C56YUK7PRG   (filename of ~/.appstoreconnect/private_keys/AuthKey_<ID>.p8)
#   ASC_ISSUER_ID    UUID from App Store Connect > Users and Access > Integrations
#
# Once the build finishes Apple processing (5-15 min), it appears in
# TestFlight on every device signed into Andrew's Apple ID — iPhone and iPad
# alike — and updates arrive as normal notifications.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT/ios"

# shellcheck disable=SC1091
[ -f "$REPO_ROOT/.env.local" ] && set -a && . "$REPO_ROOT/.env.local" && set +a

: "${ASC_KEY_ID:?Set ASC_KEY_ID in .env.local (e.g. C56YUK7PRG)}"
: "${ASC_ISSUER_ID:?Set ASC_ISSUER_ID in .env.local — App Store Connect > Users and Access > Integrations > App Store Connect API}"

KEY_PATH="$HOME/.appstoreconnect/private_keys/AuthKey_${ASC_KEY_ID}.p8"
[ -f "$KEY_PATH" ] || { echo "Missing API key at $KEY_PATH" >&2; exit 1; }

AUTH=(-authenticationKeyPath "$KEY_PATH"
      -authenticationKeyID "$ASC_KEY_ID"
      -authenticationKeyIssuerID "$ASC_ISSUER_ID")

# Build number must strictly increase for each TestFlight upload.
CURRENT=$(grep -m1 'CURRENT_PROJECT_VERSION' project.yml | sed 's/[^0-9]//g')
BUILD="${ASC_BUILD:-$((CURRENT + 1))}"
echo "==> Releasing build $BUILD"
sed -i '' "s/CURRENT_PROJECT_VERSION: \"[0-9]*\"/CURRENT_PROJECT_VERSION: \"$BUILD\"/g" project.yml
xcodegen generate >/dev/null

rm -rf build/Polytheta.xcarchive build/export

echo "==> Archiving"
xcodebuild -project Polytheta.xcodeproj -scheme Polytheta \
  -destination 'generic/platform=iOS' \
  -archivePath build/Polytheta.xcarchive \
  -allowProvisioningUpdates "${AUTH[@]}" \
  archive

echo "==> Exporting"
xcodebuild -exportArchive \
  -archivePath build/Polytheta.xcarchive \
  -exportPath build/export \
  -exportOptionsPlist ExportOptions.plist \
  -allowProvisioningUpdates "${AUTH[@]}"

IPA=$(find build/export -name '*.ipa' | head -1)
[ -n "$IPA" ] || { echo "No .ipa produced" >&2; exit 1; }

echo "==> Uploading $IPA"
xcrun altool --upload-app -f "$IPA" -t ios \
  --apiKey "$ASC_KEY_ID" --apiIssuer "$ASC_ISSUER_ID"

echo
echo "Uploaded build $BUILD. Apple processing takes ~5-15 minutes;"
echo "TestFlight will notify on iPhone and iPad when it's ready to install."
