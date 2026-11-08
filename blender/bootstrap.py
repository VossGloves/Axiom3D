"""Install blender/requirements.txt into Blender's own Python interpreter.

Run inside Blender so the interpreter Blender links against (and its bundled
numpy, which bpy requires) is the one that resolves the deps:

    blender --background --factory-startup --python blender/bootstrap.py

Deps land in blender/vendor/ with --target (never touching Blender's own
site-packages) and --no-deps (never replacing bpy's bundled numpy). worker.py
puts vendor/ on sys.path at startup.
"""

import glob
import os
import re
import subprocess
import sys
import sysconfig

HERE = os.path.dirname(os.path.abspath(__file__))
VENDOR = os.path.join(HERE, "vendor")
REQUIREMENTS = os.path.join(HERE, "requirements.txt")


def find_interpreter():
    """Path of the Python executable that matches this embedded interpreter."""
    candidates = []
    bindir = sysconfig.get_config_var("BINDIR")
    if bindir:
        candidates += glob.glob(os.path.join(bindir, "python3*"))
        candidates += glob.glob(os.path.join(bindir, "python*.exe"))
    # Common Blender layouts: <prefix>/bin/python3.x (Linux/macOS) and
    # <prefix>/bin/python.exe (Windows), where prefix is the bundled python dir.
    candidates += glob.glob(os.path.join(sys.prefix, "bin", "python3*"))
    candidates += glob.glob(os.path.join(sys.prefix, "bin", "python*.exe"))
    # Drop python3.14-config / python3-config style helper scripts.
    candidates = sorted(
        {c for c in candidates if os.path.isfile(c) and re.fullmatch(r"python(\d+(\.\d+)*)?(\.exe)?", os.path.basename(c))},
        reverse=True,
    )
    # Prefer the exact version this Blender runs.
    exact = sysconfig.get_config_var("EXEC_SUFFIX")
    if exact:
        wanted = f"python{sys.version_info.major}.{sys.version_info.minor}{exact}"
        for c in candidates:
            if os.path.basename(c) == wanted:
                return c
    return candidates[0] if candidates else None


def pip_install(python):
    cmd = [python, "-m", "pip", "install", "--no-deps", "--target", VENDOR, "-r", REQUIREMENTS]
    print("bootstrap:", " ".join(cmd), flush=True)
    result = subprocess.run(cmd)
    if result.returncode == 0:
        return 0
    # Some Blender builds ship pip lazily: bootstrap it, then retry once.
    subprocess.run([python, "-m", "ensurepip", "--default-pip"])
    return subprocess.run(cmd).returncode


def main():
    python = find_interpreter()
    if not python:
        print("bootstrap: ERROR: Blender's python executable not found under", sys.prefix, flush=True)
        return 1
    rc = pip_install(python)
    if rc != 0:
        print("bootstrap: ERROR: pip install failed", flush=True)
        return rc
    # Confirm the heavy native deps actually import against Blender's numpy.
    check = subprocess.run(
        [python, "-c", f"import sys; sys.path.insert(0, {VENDOR!r}); import scipy, trimesh; print('bootstrap: ok')"]
    )
    return check.returncode


if __name__ == "__main__":
    sys.exit(main())
