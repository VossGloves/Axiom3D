"""UV helpers shared by repair and geometry tools."""


def ensure_box_uvs(mesh):
    """Add a box-projection UV layer when the mesh has none.

    Dominant-axis per-face projection: for each face, pick the world axis its
    normal points along and project onto the other two. Correct for
    axis-aligned geometry and satisfies the gate's missing_uv check headlessly.
    """
    if mesh.uv_layers or not mesh.polygons:
        return
    uv_layer = mesh.uv_layers.new(name="UVMap")
    for poly in mesh.polygons:
        normal = poly.normal
        axis = max(range(3), key=lambda i: abs(normal[i]))
        for loop_index in poly.loop_indices:
            co = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            uv_layer.data[loop_index].uv = (co[(axis + 1) % 3], co[(axis + 2) % 3])
    mesh.update()
