#!/bin/sh
# Xcode build phase of the app target: copies the Python standard library,
# the app's Python modules and the bundled packages into the app, and turns
# each binary module into a framework, as iOS requires (see CPython's
# "Using Python on iOS" and Python.xcframework/build/utils.sh).
set -e

MODULE_DIR="$PROJECT_DIR/../modules/superapp-native"
XCFRAMEWORK="$MODULE_DIR/ios/Python.xcframework"
APP="$CODESIGNING_FOLDER_PATH"

if [ ! -d "$XCFRAMEWORK" ] || [ ! -d "$MODULE_DIR/build/app_packages" ]; then
  echo "error: run modules/superapp-native/scripts/fetch-python.sh before building"
  exit 1
fi

if [ "$EFFECTIVE_PLATFORM_NAME" = "-iphonesimulator" ]; then
  SLICE="ios-arm64_x86_64-simulator"
else
  SLICE="ios-arm64"
fi
ARCH="${ARCHS%% *}"

mkdir -p "$APP/python/lib"
rsync -a --delete "$XCFRAMEWORK/lib/" "$APP/python/lib/" --exclude 'libpython*.dylib'
rsync -a "$XCFRAMEWORK/$SLICE/lib-$ARCH/" "$APP/python/lib/" --exclude 'libpython*.dylib'
PYTHON_VER=$(ls -1 "$APP/python/lib" | grep -E '^python3\.[0-9]+$')
STDLIB="$APP/python/lib/$PYTHON_VER"

# Parts of the standard library a downloader never imports.
for unused in test idlelib tkinter turtledemo ensurepip lib2to3 pydoc_data venv; do
  rm -rf "$STDLIB/$unused"
done
find "$STDLIB/lib-dynload" \( -name '_test*' -o -name '_xxtestfuzz*' -o -name '_ctypes_test*' -o -name 'xxsubtype*' \) -delete

rsync -a --delete "$MODULE_DIR/python/" "$APP/app/" --exclude requirements.txt
rsync -a --delete "$MODULE_DIR/build/app_packages/" "$APP/app_packages/"

TEMPLATE="$XCFRAMEWORK/build/iOS-dylib-Info-template.plist"
install_dylib() {
  BASE="$1"
  FULL_EXT="$2"
  RELATIVE_EXT=${FULL_EXT#$APP/}
  PYTHON_EXT=${RELATIVE_EXT#$BASE/}
  MODULE_NAME=$(echo "$PYTHON_EXT" | cut -d "." -f 1 | tr "/" ".")
  FRAMEWORK="Frameworks/$MODULE_NAME.framework"
  mkdir -p "$APP/$FRAMEWORK"
  cp "$TEMPLATE" "$APP/$FRAMEWORK/Info.plist"
  plutil -replace CFBundleExecutable -string "$MODULE_NAME" "$APP/$FRAMEWORK/Info.plist"
  plutil -replace CFBundleIdentifier -string "$(echo "$PRODUCT_BUNDLE_IDENTIFIER.$MODULE_NAME" | tr "_" "-")" "$APP/$FRAMEWORK/Info.plist"
  mv "$FULL_EXT" "$APP/$FRAMEWORK/$MODULE_NAME"
  echo "$FRAMEWORK/$MODULE_NAME" > "${FULL_EXT%.so}.fwork"
  echo "${RELATIVE_EXT%.so}.fwork" > "$APP/$FRAMEWORK/$MODULE_NAME.origin"
  if [ "$CODE_SIGNING_ALLOWED" = "YES" ] && [ -n "$EXPANDED_CODE_SIGN_IDENTITY" ]; then
    /usr/bin/codesign --force --sign "$EXPANDED_CODE_SIGN_IDENTITY" ${OTHER_CODE_SIGN_FLAGS:-} -o runtime --timestamp=none --preserve-metadata=identifier,entitlements,flags --generate-entitlement-der "$APP/$FRAMEWORK"
  fi
}

find "$STDLIB/lib-dynload" -name "*.so" | while read -r FULL_EXT; do
  install_dylib "python/lib/$PYTHON_VER/lib-dynload" "$FULL_EXT"
done
find "$APP/app_packages" -name "*.so" | while read -r FULL_EXT; do
  install_dylib "app_packages" "$FULL_EXT"
done
