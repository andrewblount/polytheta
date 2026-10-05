#!/usr/bin/env bash
# Build the Mac app from the same native sources as the iOS release.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"
xcodegen generate --spec ios/project.yml
AUTH=()
if [ -f .env.local ]; then
  MAC_ASC_KEY_ID="$(node --env-file=.env.local -p 'process.env.ASC_KEY_ID || ""')"
  MAC_ASC_ISSUER_ID="$(node --env-file=.env.local -p 'process.env.ASC_ISSUER_ID || ""')"
  if [ -n "$MAC_ASC_KEY_ID" ] && [ -n "$MAC_ASC_ISSUER_ID" ]; then
    AUTH=(-authenticationKeyPath "$HOME/.appstoreconnect/private_keys/AuthKey_${MAC_ASC_KEY_ID}.p8"
          -authenticationKeyID "$MAC_ASC_KEY_ID" -authenticationKeyIssuerID "$MAC_ASC_ISSUER_ID")
  fi
fi
xcodebuild -project ios/Polytheta.xcodeproj -scheme PolythetaMac \
  -configuration Release -destination 'platform=macOS' \
  -derivedDataPath ios/build/mac -allowProvisioningUpdates \
  -allowProvisioningDeviceRegistration "${AUTH[@]}" build
echo "Built app: $REPO_ROOT/ios/build/mac/Build/Products/Release/Polytheta.app"
