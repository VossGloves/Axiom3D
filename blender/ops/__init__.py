"""Axiom3D operator helpers — modifier and detail operations for agent scripts.

Importable from exec namespace: from ops import add_bevel, scatter_details, ...
Every helper returns the modifier/object so callers can chain. Helpers are thin
wrappers — the agent can always fall back to raw bpy when a helper's defaults
don't fit.
"""

from ops.modifiers import (
    add_array,
    add_bevel,
    add_boolean,
    add_mirror,
    add_solidify,
    add_subsurf,
    apply_all_modifiers,
    bevel_all_boxes,
)
from ops.deform import (
    add_deform,
    add_displace,
    add_remesh,
    instance_object,
)
from ops.details import (
    add_panel_lines,
    scatter_details,
    scatter_edge_bolts,
)

__all__ = [
    "add_array",
    "add_bevel",
    "add_boolean",
    "add_mirror",
    "add_solidify",
    "add_subsurf",
    "apply_all_modifiers",
    "bevel_all_boxes",
    "add_deform",
    "add_displace",
    "add_remesh",
    "instance_object",
    "add_panel_lines",
    "scatter_details",
    "scatter_edge_bolts",
]
