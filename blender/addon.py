"""Axiom3D Blender GUI addon.

Installs a socket server inside Blender GUI so external clients (Axiom3D tools)
can attach and push commands. Pumps via bpy.app.timers (main thread is UI event loop).

Install (development):
  ln -s /path/to/Axiom3D/blender/addon.py ~/.config/blender/5.2/scripts/addons/axiom3d.py
  Then enable in Edit > Preferences > Add-ons > "Axiom3D"

Or copy blender/ directory contents into a folder and symlink that.
"""

bl_info = {
    "name": "Axiom3D",
    "author": "Axiom3D",
    "version": (0, 1, 0),
    "blender": (5, 2, 0),
    "location": "View3D > Sidebar > Axiom3D",
    "description": "Socket server for Axiom3D asset harness: attach external tools to this Blender session",
    "category": "System",
}

import os
import sys

import bpy

# Bootstrap: find blender/ parent directory and add to sys.path so transport/rpc import.
# When installed as addon (symlink or copy), resolve symlink to find actual location.
_ADDON_FILE = os.path.realpath(__file__)  # resolves symlinks
_ADDON_DIR = os.path.dirname(_ADDON_FILE)
_BLENDER_DIR = _ADDON_DIR
if not os.path.exists(os.path.join(_BLENDER_DIR, "transport.py")):
    # Not in blender/ directly; try env var or give up
    _BLENDER_DIR = os.environ.get("AXIOM3D_BLENDER_DIR", _ADDON_DIR)
for _path in (_BLENDER_DIR, os.path.join(_BLENDER_DIR, "vendor")):
    if _path not in sys.path:
        sys.path.insert(0, _path)

# Ensure AXIOM3D_ROOT points to repo root (parent of blender/) BEFORE importing
# rpc.base, so the port file lands in the right place regardless of Blender's cwd.
_repo_root = os.path.dirname(_BLENDER_DIR)
os.environ.setdefault("AXIOM3D_ROOT", _repo_root)

import transport  # noqa: E402
from rpc.base import AXIOM_DIR, STATE  # noqa: E402


class AXIOM3D_OT_start(bpy.types.Operator):
    """Start Axiom3D socket server"""
    bl_idname = "axiom3d.start_server"
    bl_label = "Start Server"

    def execute(self, context):
        if not bpy.app.background and STATE.get("mode") == "gui":
            self.report({"INFO"}, "Axiom3D server already running")
            return {"CANCELLED"}
        try:
            transport.run_gui()
        except Exception as exc:
            self.report({"ERROR"}, f"Failed to start: {exc}")
            return {"CANCELLED"}
        self.report({"INFO"}, f"Started on port {transport.write_port_file.port}")
        return {"FINISHED"}


class AXIOM3D_OT_stop(bpy.types.Operator):
    """Stop Axiom3D socket server"""
    bl_idname = "axiom3d.stop_server"
    bl_label = "Stop Server"

    def execute(self, context):
        transport.stop_server()
        # Unregister timer by marking poisoned and letting it die next tick.
        STATE["poisoned"] = True
        self.report({"INFO"}, "Stopped")
        return {"FINISHED"}


class AXIOM3D_PT_panel(bpy.types.Panel):
    """Sidebar panel for Axiom3D server controls"""
    bl_label = "Axiom3D"
    bl_idname = "AXIOM3D_PT_panel"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Axiom3D"

    def draw(self, context):
        layout = self.layout
        running = STATE.get("mode") == "gui" and not STATE.get("poisoned", True)
        if running:
            port = transport.write_port_file.port if hasattr(transport, "write_port_file") else "?"
            layout.label(text=f"Running on port {port}")
            layout.label(text=f"Poisoned: {STATE.get('poisoned', False)}")
            layout.operator("axiom3d.stop_server", text="Stop", icon="PAUSE")
        else:
            layout.operator("axiom3d.start_server", text="Start Server", icon="PLAY")


def _auto_start():
    """Timer callback: auto-start server if enabled and not already running."""
    if bpy.context.preferences.addons.get(__name__) is None:
        return None  # addon disabled, unregister timer
    if STATE.get("mode") != "gui" and not bpy.app.background:
        try:
            transport.run_gui()
        except Exception:
            pass  # already running or failed; panel shows status
    return None  # one-shot timer


def register():
    bpy.utils.register_class(AXIOM3D_OT_start)
    bpy.utils.register_class(AXIOM3D_OT_stop)
    bpy.utils.register_class(AXIOM3D_PT_panel)
    # Delayed auto-start so Blender finishes loading before binding socket.
    bpy.app.timers.register(_auto_start, first_interval=1.0, persistent=True)


def unregister():
    transport.stop_server()
    bpy.utils.unregister_class(AXIOM3D_OT_start)
    bpy.utils.unregister_class(AXIOM3D_OT_stop)
    bpy.utils.unregister_class(AXIOM3D_PT_panel)


if __name__ == "__main__":
    register()
