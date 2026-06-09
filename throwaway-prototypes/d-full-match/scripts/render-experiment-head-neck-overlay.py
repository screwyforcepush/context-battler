"""Render base-vs-experiment head/neck alignment diagnostics.

The cyan shell is the original Mesh2Motion head/neck region. The warm shell is
the current experiment replacement head/neck. Gray shows the current collar and
upper torso receiving geometry.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Vector

if not hasattr(np, "bool"):
    np.bool = bool


SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
BASE_GLB = PROJECT_ROOT / "shared-harness/art-kit/characters/camper-mesh2motion-human-base.glb"
EXPERIMENT_GLB = PROJECT_ROOT / "shared-harness/art-kit/characters/generated/experiment.glb"
GENERATOR = SCRIPT_DIR / "build-experiment-reallusion-head-blender.py"


def parse_args() -> argparse.Namespace:
    argv = sys.argv
    if "--" in argv:
        argv = argv[argv.index("--") + 1 :]
    else:
        argv = []
    parser = argparse.ArgumentParser()
    parser.add_argument("--out-dir", default=str(PROJECT_ROOT.parent.parent / "screenshots/head-neck-overlay"))
    parser.add_argument("--width", type=int, default=960)
    parser.add_argument("--height", type=int, default=960)
    return parser.parse_args(argv)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for block in (
        bpy.data.meshes,
        bpy.data.materials,
        bpy.data.images,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for item in list(block):
            block.remove(item)


def import_glb(path: Path, prefix: str) -> list[bpy.types.Object]:
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    imported = [obj for obj in bpy.context.scene.objects if obj not in before]
    for obj in imported:
        obj.name = f"{prefix}_{obj.name}"
        if obj.data is not None:
            obj.data.name = f"{prefix}_{obj.data.name}"
    return imported


def make_mat(name: str, color: tuple[float, float, float, float], metallic: float = 0.0, roughness: float = 0.5) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_nodes = True
    mat.blend_method = "BLEND"
    mat.show_transparent_back = True
    mat.use_screen_refraction = False
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf is not None:
        bsdf.inputs["Base Color"].default_value = color
        bsdf.inputs["Alpha"].default_value = color[3]
        bsdf.inputs["Metallic"].default_value = metallic
        bsdf.inputs["Roughness"].default_value = roughness
    return mat


def assign_material(obj: bpy.types.Object, mat: bpy.types.Material) -> None:
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    for poly in obj.data.polygons:
        poly.material_index = 0


def duplicate_region(
    obj: bpy.types.Object,
    name: str,
    floor_z: float,
    ceiling_z: float | None,
    mat: bpy.types.Material,
    max_abs_x: float | None = None,
) -> bpy.types.Object | None:
    mesh = obj.data.copy()
    region = obj.copy()
    region.data = mesh
    region.animation_data_clear()
    region.name = name
    region.data.name = f"{name}_mesh"
    bpy.context.collection.objects.link(region)
    assign_material(region, mat)

    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()
    delete_faces = []
    matrix = region.matrix_world.copy()
    for face in bm.faces:
        center = sum((matrix @ vert.co for vert in face.verts), Vector()) / len(face.verts)
        if center.z < floor_z:
            delete_faces.append(face)
            continue
        if ceiling_z is not None and center.z > ceiling_z:
            delete_faces.append(face)
            continue
        if max_abs_x is not None and abs(center.x) > max_abs_x:
            delete_faces.append(face)
    if delete_faces:
        bmesh.ops.delete(bm, geom=delete_faces, context="FACES")
    loose = [vert for vert in bm.verts if not vert.link_faces]
    if loose:
        bmesh.ops.delete(bm, geom=loose, context="VERTS")
    remaining_faces = len(bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()

    if remaining_faces == 0:
        bpy.data.objects.remove(region, do_unlink=True)
        return None
    return region


def hide_objects(objects: list[bpy.types.Object]) -> None:
    for obj in objects:
        obj.hide_set(True)
        obj.hide_render = True


def mesh_objects(objects: list[bpy.types.Object]) -> list[bpy.types.Object]:
    return [obj for obj in objects if obj.type == "MESH"]


def world_vertices(objects: list[bpy.types.Object]) -> list[Vector]:
    verts: list[Vector] = []
    for obj in objects:
        if obj.type != "MESH":
            continue
        matrix = obj.matrix_world
        verts.extend(matrix @ vert.co for vert in obj.data.vertices)
    return verts


def bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    verts = world_vertices(objects)
    if not verts:
        return Vector((-0.25, -0.25, 1.25)), Vector((0.25, 0.25, 1.95))
    min_v = Vector((min(v.x for v in verts), min(v.y for v in verts), min(v.z for v in verts)))
    max_v = Vector((max(v.x for v in verts), max(v.y for v in verts), max(v.z for v in verts)))
    return min_v, max_v


def read_target_lower_z() -> float:
    text = GENERATOR.read_text(encoding="utf-8")
    match = re.search(r"target_lower_z\s*=\s*([0-9.]+)", text)
    if not match:
        return 1.431
    return float(match.group(1))


def band_center(
    objects: list[bpy.types.Object],
    z_center: float,
    half_height: float,
    max_abs_x: float,
    max_abs_y: float,
) -> Vector | None:
    samples = [
        vert
        for vert in world_vertices(objects)
        if abs(vert.z - z_center) <= half_height and abs(vert.x) <= max_abs_x and abs(vert.y) <= max_abs_y
    ]
    if not samples:
        return None
    return sum(samples, Vector()) / len(samples)


def add_marker(name: str, location: Vector, mat: bpy.types.Material, radius: float = 0.012) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, radius=radius, location=location)
    obj = bpy.context.object
    obj.name = name
    assign_material(obj, mat)
    return obj


def add_delta_line(start: Vector, end: Vector, mat: bpy.types.Material) -> bpy.types.Object | None:
    delta = end - start
    length = delta.length
    if length < 0.001:
        return None
    mid = start + delta * 0.5
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=0.004, depth=length, location=mid)
    obj = bpy.context.object
    obj.name = "head_neck_delta_vector"
    obj.rotation_euler = delta.to_track_quat("Z", "Y").to_euler()
    assign_material(obj, mat)
    return obj


def look_at(camera: bpy.types.Object, target: Vector) -> None:
    direction = target - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def setup_scene(width: int, height: int) -> bpy.types.Object:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.use_gtao = True
    scene.eevee.gtao_distance = 2.0
    scene.eevee.gtao_factor = 1.2
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Filmic"
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1
    bpy.context.scene.world = bpy.data.worlds.new("overlay_world") if bpy.context.scene.world is None else bpy.context.scene.world
    bpy.context.scene.world.color = (0.028, 0.030, 0.032)

    bpy.ops.object.light_add(type="AREA", location=(0.0, -2.8, 2.4))
    key = bpy.context.object
    key.name = "overlay_key_light"
    key.data.energy = 520
    key.data.size = 2.2

    bpy.ops.object.light_add(type="AREA", location=(0.0, 2.6, 2.0))
    rim = bpy.context.object
    rim.name = "overlay_rear_light"
    rim.data.energy = 240
    rim.data.size = 1.8

    bpy.ops.object.camera_add()
    camera = bpy.context.object
    camera.name = "overlay_camera"
    camera.data.type = "ORTHO"
    bpy.context.scene.camera = camera
    return camera


def render_view(camera: bpy.types.Object, name: str, location: tuple[float, float, float], target: Vector, ortho_scale: float, out_dir: Path) -> Path:
    camera.location = Vector(location)
    look_at(camera, target)
    camera.data.ortho_scale = ortho_scale
    path = out_dir / f"head_neck_overlay_{name}.png"
    bpy.context.scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    return path


def main() -> None:
    args = parse_args()
    out_dir = Path(args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)

    clear_scene()
    camera = setup_scene(args.width, args.height)

    ref_mat = make_mat("overlay_base_reference_cyan", (0.05, 0.85, 1.0, 0.30), 0.0, 0.28)
    current_mat = make_mat("overlay_current_head_warm", (1.0, 0.18, 0.08, 0.62), 0.0, 0.35)
    collar_mat = make_mat("overlay_current_collar_gray", (0.72, 0.74, 0.70, 0.22), 0.0, 0.48)
    base_marker_mat = make_mat("overlay_base_center_dot", (0.0, 1.0, 1.0, 1.0), 0.0, 0.2)
    current_marker_mat = make_mat("overlay_current_center_dot", (1.0, 0.05, 0.0, 1.0), 0.0, 0.2)
    delta_mat = make_mat("overlay_delta_vector_yellow", (1.0, 0.92, 0.10, 1.0), 0.0, 0.28)

    base_objects = import_glb(BASE_GLB, "BASE")
    base_meshes = mesh_objects(base_objects)
    if not base_meshes:
        raise RuntimeError(f"No mesh objects imported from {BASE_GLB}")
    base_main = max(base_meshes, key=lambda obj: len(obj.data.vertices))
    base_reference = duplicate_region(base_main, "base_original_head_neck_reference", 1.30, 1.96, ref_mat, max_abs_x=0.34)
    hide_objects(base_objects)
    if base_reference is None:
        raise RuntimeError("Failed to create base head/neck reference region")

    experiment_objects = import_glb(EXPERIMENT_GLB, "CURRENT")
    experiment_meshes = mesh_objects(experiment_objects)
    head_objects = [obj for obj in experiment_meshes if "experiment_reallusion_integrated_head" in obj.name]
    if not head_objects:
        raise RuntimeError("Could not find experiment_reallusion_integrated_head in current experiment GLB")

    accessory_tokens = ("experiment_reallusion_integrated_head", "experiment_reallusion_eyes", "experiment_reallusion_teeth", "experiment_reallusion_tongue")
    torso_sources = [obj for obj in experiment_meshes if not any(token in obj.name for token in accessory_tokens)]
    torso_regions = [
        region
        for source in torso_sources
        if (region := duplicate_region(source, f"{source.name}_upper_collar_overlay", 1.18, 1.78, collar_mat, max_abs_x=0.48)) is not None
    ]

    for obj in head_objects:
        assign_material(obj, current_mat)
    hidden_experiment = [obj for obj in experiment_objects if obj.type != "MESH" or obj not in head_objects]
    hide_objects(hidden_experiment)

    target_lower_z = read_target_lower_z()
    base_center = band_center([base_reference], target_lower_z, 0.04, 0.18, 0.22)
    current_center = band_center(head_objects, target_lower_z, 0.04, 0.20, 0.24)
    if base_center is not None:
        add_marker("base_neck_band_center_cyan", base_center, base_marker_mat)
    if current_center is not None:
        add_marker("current_neck_band_center_red", current_center, current_marker_mat)
    if base_center is not None and current_center is not None:
        add_delta_line(base_center, current_center, delta_mat)

    visible_objects = [base_reference, *head_objects, *torso_regions]
    min_v, max_v = bounds(visible_objects)
    target = Vector(((min_v.x + max_v.x) * 0.5, (min_v.y + max_v.y) * 0.5, 1.55))
    ortho_scale = max(0.72, (max_v.z - min_v.z) * 1.18, (max_v.x - min_v.x) * 1.65)

    outputs = {
        "front": render_view(camera, "front", (0.0, -3.2, 1.56), target, ortho_scale, out_dir).name,
        "back": render_view(camera, "back", (0.0, 3.2, 1.56), target, ortho_scale, out_dir).name,
        "left": render_view(camera, "left", (3.2, 0.0, 1.56), target, ortho_scale, out_dir).name,
        "right": render_view(camera, "right", (-3.2, 0.0, 1.56), target, ortho_scale, out_dir).name,
    }

    metrics = {
        "base_glb": str(BASE_GLB.relative_to(PROJECT_ROOT)),
        "experiment_glb": str(EXPERIMENT_GLB.relative_to(PROJECT_ROOT)),
        "generator_target_lower_z": target_lower_z,
        "neck_band_half_height": 0.04,
        "base_neck_band_center": list(base_center) if base_center is not None else None,
        "experiment_neck_band_center": list(current_center) if current_center is not None else None,
        "experiment_minus_base_delta": list(current_center - base_center) if base_center is not None and current_center is not None else None,
        "render_outputs": outputs,
        "legend": {
            "cyan": "original Mesh2Motion base head/neck reference",
            "warm_red": "current experiment Reallusion replacement head/neck",
            "gray": "current experiment upper torso/collar receiving geometry",
            "dots": "neck-band center samples at generator target_lower_z",
            "yellow_line": "delta from base neck-band center to experiment neck-band center",
        },
    }
    (out_dir / "head_neck_overlay_metrics.json").write_text(json.dumps(metrics, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
