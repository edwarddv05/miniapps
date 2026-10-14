#!/bin/sh
# Turns the unsigned Release .app into an .ipa for AltStore/SideStore.
# Everything is signed ad hoc with its entitlements: AltStore and SideStore
# re-sign with the owner's Apple ID and read the App Groups from here.
set -e
APP="$1"
OUT="$2"
GROUP="group.com.mysuperapp.miniapps"
WORK=$(mktemp -d)

cat > "$WORK/group.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.security.application-groups</key><array><string>$GROUP</string></array>
</dict></plist>
PLIST
cat > "$WORK/none.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict/></plist>
PLIST

find "$APP/Frameworks" -maxdepth 1 \( -name '*.framework' -o -name '*.dylib' \) -print0 | xargs -0 -n 1 codesign --force --sign - --timestamp=none
for EXTENSION in "$APP"/PlugIns/*.appex; do
  [ -d "$EXTENSION" ] || continue
  ID=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$EXTENSION/Info.plist")
  case "$ID" in
    *.widget) ENTITLEMENTS="$WORK/group.plist" ;;
    *) ENTITLEMENTS="$WORK/none.plist" ;;
  esac
  codesign --force --sign - --timestamp=none --entitlements "$ENTITLEMENTS" "$EXTENSION"
done
codesign --force --sign - --timestamp=none --entitlements "$WORK/group.plist" "$APP"

mkdir -p "$WORK/Payload" "$(dirname "$OUT")"
cp -R "$APP" "$WORK/Payload/"
OUT_ABS="$(cd "$(dirname "$OUT")" && pwd)/$(basename "$OUT")"
rm -f "$OUT_ABS"
(cd "$WORK" && zip -qry "$OUT_ABS" Payload)
rm -rf "$WORK"
echo "$OUT_ABS"
