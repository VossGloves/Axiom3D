#!/usr/bin/env bash
# Build the libfive native libraries for one platform target and package the
# complete `libfive` python package (MPL-2.0 bindings from blender/libfive-pkg/
# + native libs) as dist/libfive-<target>.tar.gz.
#
# Usage: ./blender/build-libfive.sh <target>
#   target: linux-x64 | linux-arm64 | darwin-x64 | darwin-arm64 | windows-x64
#
# Env:
#   LIBFIVE_REPO  fork/repo to build (default: AonoZan/libfive — matches the
#                 vendored python bindings, which target libfive @379a54db)
#   LIBFIVE_REF   commit to check out
#   VCPKG_ROOT    required for windows-x64 (eigen3, boost, libpng)
#
# Output: dist/libfive-<target>.tar.gz with layout:
#   libfive/*.py, libfive/stdlib/*.py, libfive/NOTICE
#   libfive/src/libfive.<so|dylib|dll>, libfive/src/libfive-stdlib.<...>
set -euo pipefail

TARGET="${1:-}"
case "$TARGET" in
  linux-x64|linux-arm64|darwin-x64|darwin-arm64|windows-x64) ;;
  *) echo "usage: $0 <linux-x64|linux-arm64|darwin-x64|darwin-arm64|windows-x64>" >&2; exit 2 ;;
esac

REPO="${LIBFIVE_REPO:-AonoZan/libfive}"
REF="${LIBFIVE_REF:-379a54dbbdfd0724100baa6feddb7083ab0e6767}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
OUT="$ROOT/dist"
mkdir -p "$OUT"

echo "==> cloning $REPO@$REF"
git clone -q "https://github.com/$REPO.git" "$WORK/libfive-src"
git -C "$WORK/libfive-src" checkout -q "$REF"

SRC="$WORK/libfive-src"

# Strip CPU-specific flags: release binaries must run on every machine, not
# just the build runner.
sed -i.bak '/-march=native/d' "$SRC/CMakeLists.txt"
sed -i.bak 's| /arch:AVX2||' "$SRC/CMakeLists.txt"
# Upstream's MSVC branch asks for lowercase "boost" with a version, which
# resolves through neither vcpkg's config (case/version) nor CMake 4's
# removed FindBoost module. Ask vcpkg's BoostConfig directly.
sed -i.bak 's/find_package(boost REQUIRED 1.65.0)/find_package(Boost CONFIG REQUIRED)/' "$SRC/CMakeLists.txt"
# Upstream writes "/MD/" — MSVC tolerates the stray slash only as a warning.
sed -i.bak 's|/MD/|/MD |' "$SRC/CMakeLists.txt"

COMMON_ARGS=(
  -DCMAKE_BUILD_TYPE=Release
  -DBUILD_STUDIO_APP=OFF
  -DBUILD_GUILE_BINDINGS=OFF
  -DBUILD_PYTHON_BINDINGS=OFF
  -DBUILD_TESTS=OFF
  -DENABLE_DEBUG=OFF
)
BUILD_DIR="$WORK/build"
JOBS="$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)"

if [ "$TARGET" = "windows-x64" ]; then
  if [ -z "${VCPKG_ROOT:-}" ]; then
    echo "error: VCPKG_ROOT must point at a vcpkg checkout (eigen3, boost, libpng)" >&2
    exit 1
  fi
  # Ninja + the MSVC env from ilammy/msvc-dev-cmd; CMake's Visual Studio
  # generator discovery is unreliable under git-bash on GitHub runners.
  GEN=(-G Ninja)
  command -v ninja >/dev/null 2>&1 || GEN=(-G "Visual Studio 17 2022")
  echo "==> configuring (MSVC + vcpkg, generator: ${GEN[*]})"
  cmake -S "$SRC" -B "$BUILD_DIR" "${GEN[@]}" \
    -DCMAKE_TOOLCHAIN_FILE="$VCPKG_ROOT/scripts/buildsystems/vcpkg.cmake" \
    "${COMMON_ARGS[@]}"
  echo "==> building libfive libfive-stdlib"
  cmake --build "$BUILD_DIR" --config Release --target libfive libfive-stdlib --parallel "$JOBS"
  LIBFIVE_LIB="$(find "$BUILD_DIR" -name 'libfive.dll' -not -name '*stdlib*' | head -1)"
  STDLIB_LIB="$(find "$BUILD_DIR" -name 'libfive-stdlib.dll' | head -1)"
  RPATH_ARGS=()
else
  case "$TARGET" in
    darwin-*) DEPLOY=11.0; [ "${TARGET#*-}" = "x64" ] && DEPLOY=10.15 ;;
    *) DEPLOY="" ;;
  esac
  [ -n "$DEPLOY" ] && export MACOSX_DEPLOYMENT_TARGET="$DEPLOY"

  # Load both libs from the package's libfive/src/ directory at runtime.
  case "$TARGET" in
    darwin-*) RPATH_FLAG="-Wl,-rpath,@loader_path" ;;
    *) RPATH_FLAG="-Wl,-rpath,\$ORIGIN" ;;
  esac
  RPATH_ARGS=(-DCMAKE_SHARED_LINKER_FLAGS="$RPATH_FLAG")

  echo "==> configuring"
  cmake -S "$SRC" -B "$BUILD_DIR" "${COMMON_ARGS[@]}" "${RPATH_ARGS[@]}"
  echo "==> building libfive libfive-stdlib"
  cmake --build "$BUILD_DIR" --target libfive libfive-stdlib --parallel "$JOBS"
  LIBFIVE_LIB="$(find "$BUILD_DIR" \( -name 'libfive.so' -o -name 'libfive.dylib' \) -not -name '*stdlib*' | head -1)"
  STDLIB_LIB="$(find "$BUILD_DIR" \( -name 'libfive-stdlib.so' -o -name 'libfive-stdlib.dylib' \) | head -1)"
fi

if [ -z "$LIBFIVE_LIB" ] || [ -z "$STDLIB_LIB" ]; then
  echo "error: built libraries not found under $BUILD_DIR" >&2
  find "$BUILD_DIR" -name 'libfive*' -maxdepth 4 >&2 || true
  exit 1
fi

echo "==> packaging"
STAGE="$WORK/pkg/libfive"
mkdir -p "$STAGE/src"
cp -R "$ROOT/blender/libfive-pkg/." "$STAGE/"
rm -rf "$STAGE/__pycache__" "$STAGE/stdlib/__pycache__"
cp "$LIBFIVE_LIB" "$STAGE/src/$(basename "$LIBFIVE_LIB")"
cp "$STDLIB_LIB" "$STAGE/src/$(basename "$STDLIB_LIB")"

if [ "$TARGET" = "windows-x64" ] && [ -n "${VCPKG_ROOT:-}" ]; then
  # Dynamic vcpkg triplet: libfive.dll links libpng/zlib DLLs, and Blender
  # only resolves them from the DLL directory registered in sdf.py.
  for dll in "$VCPKG_ROOT"/installed/x64-windows/bin/*.dll; do
    if [ -f "$dll" ]; then
      cp "$dll" "$STAGE/src/"
    fi
  done
fi

TARBALL="$OUT/libfive-$TARGET.tar.gz"
tar -czf "$TARBALL" -C "$WORK/pkg" libfive
echo "wrote $TARBALL"
