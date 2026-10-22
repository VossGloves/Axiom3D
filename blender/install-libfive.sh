#!/usr/bin/env bash
# Vendor libfive python bindings (MPL-2.0) into blender/vendor/libfive/.
# Source: FieldForge v0.7.2 linux release build (libfive @379a54db); only the
# libfive package is MPL-2.0 — FieldForge's own addon code is GPL-3.0 and is
# NOT vendored. libcustom_c_utils.so (FieldForge-authored, GPL) is deleted;
# ffi.py gets a one-line patch so its loader tolerates the missing library.
set -euo pipefail

URL="https://github.com/AonoZan/FieldForge/releases/download/v0.7.2/FieldForge-lin-v0.7.2.zip"
SHA256="0fe586ac14ccd06bbae38ddb3bd82cbd66934b2d54fbad583ed8a6b9d118d437"
DEST="$(cd "$(dirname "$0")" && pwd)/vendor"

if [[ "$(uname -s)" != "Linux" ]]; then
  echo "install-libfive: linux release zip only; build libfive from source on other OS" >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

curl -sL -o "$work/fieldforge.zip" "$URL"
echo "$SHA256  $work/fieldforge.zip" | sha256sum -c -
unzip -q "$work/fieldforge.zip" 'FieldForge/libfive/*' -d "$work"

rm -rf "$DEST/libfive"
cp -r "$work/FieldForge/libfive" "$DEST/libfive"
rm -f "$DEST/libfive/src/libcustom_c_utils.so"
# link_lib() raises RuntimeError for a missing lib; ffi.py only catches OSError,
# which kills `import libfive.ffi` once the GPL companion lib is removed.
sed -i 's/except OSError as e:/except (OSError, RuntimeError) as e:/' "$DEST/libfive/ffi.py"

cat > "$DEST/NOTICE" <<'EOF'
libfive python bindings vendored from FieldForge v0.7.2 linux release build
(libfive @379a54dbbdfd0724100baa6feddb7083ab0e6767, AonoZan/libfive fork).
Files: blender/vendor/libfive/** — Copyright (C) 2021 Matt Keeter,
licensed under the Mozilla Public License, v. 2.0 (MPL-2.0),
https://www.mozilla.org/en-US/MPL/2.0/. Each source file carries the MPL header.
Modifications: libcustom_c_utils.so (GPL-3.0, FieldForge-authored) not shipped;
ffi.py missing-library handler extended to catch RuntimeError.
FieldForge's GPL-3.0 addon code (core/, ui/, utils.py, constants.py, ...) is
NOT vendored and must never be copied into this repository.
EOF

echo "libfive installed: $DEST/libfive"
