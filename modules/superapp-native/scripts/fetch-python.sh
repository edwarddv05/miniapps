#!/bin/sh
# Prepares what the app embeds: BeeWare's Python.xcframework and the
# pure-Python packages. Run on macOS with the same Python minor version.
set -e
cd "$(dirname "$0")/.."

PYTHON_TAG="3.14-b12"
PYTHON_MINOR="3.14"
HOST_PYTHON="${HOST_PYTHON:-python$PYTHON_MINOR}"

if [ ! -d ios/Python.xcframework ]; then
  curl -fsSL "https://github.com/beeware/Python-Apple-support/releases/download/$PYTHON_TAG/Python-$PYTHON_MINOR-iOS-support.${PYTHON_TAG#*-}.tar.gz" -o /tmp/python-ios.tar.gz
  tar -xzf /tmp/python-ios.tar.gz -C ios Python.xcframework
  rm /tmp/python-ios.tar.gz
fi

rm -rf build/app_packages
"$HOST_PYTHON" -m pip install --quiet --no-deps --no-compile --only-binary=:all: \
  --platform any --python-version "$PYTHON_MINOR" --implementation py \
  --target build/app_packages -r python/requirements.txt
rm -rf build/app_packages/bin build/app_packages/share

# Byte-code compiled ahead of time: the app cannot write caches next to its
# sources, and yt-dlp would otherwise be recompiled on every launch.
"$HOST_PYTHON" -m compileall -q -j 0 --invalidation-mode unchecked-hash build/app_packages python ios/Python.xcframework/lib > /dev/null
