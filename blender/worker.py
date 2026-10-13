"""Axiom3D persistent Blender worker (headless entry point).

Runs inside headless Blender:  blender --background --factory-startup --python worker.py

Transport (TCP, jobs pump) lives in transport.py; handlers live in rpc/.
This file just bootstraps paths and calls transport.run_background().
"""

import os
import sys

# Bootstrap: make blender/ (handler packages) and vendor/ (pip --target deps like
# trimesh) importable no matter what cwd Blender was launched with.
HERE = os.path.dirname(os.path.abspath(__file__))
for _path in (os.path.join(HERE, "vendor"), HERE):
    if _path not in sys.path:
        sys.path.insert(0, _path)

import bpy  # noqa: E402 - isort: skip (bpy is builtin; path bootstrap above must precede rpc imports)

from rpc.base import log_error  # noqa: E402
from transport import run_background  # noqa: E402

sys.excepthook = lambda *args: log_error()

run_background()
