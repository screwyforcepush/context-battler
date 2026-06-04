#!/usr/bin/env python3
"""Build a neutral Mesh2Motion carrier for the showroom experiment slot."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

import bpy
from mathutils import Vector


VARIANT_ID = "experiment"


def main() -> None:
    patch_blender_numpy_compat()
    args = parse_args()
    project_root = Path(args.project_root).resolve()
    base_glb = project_root / "shared-harness/art-kit/characters/camper-mesh2motion-human-base.glb"
    dist_dir = project_root / "dist/characters" / VARIANT_ID
    art_dir = project_root / "shared-harness/art-kit/characters/generated"
    dist_dir.mkdir(parents=True, exist_ok=True)
    art_dir.mkdir(parents=True, exist_ok=True)
    (project_root / "dist/characters/.gdignore").write_text(
        "Generated authoring artifacts; runtime assets live under shared-harness.\n",
        encoding="utf-8",
    )

    cleanup_stale_generated_textures(art_dir)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    bpy.ops.import_scene.gltf(filepath=str(base_glb))

    armature = first_object_of_type("ARMATURE")
    if armature is None:
        raise RuntimeError("Imported base GLB did not contain an Armature")

    neutral = make_mat("EX_blank_neutral_carrier", (0.62, 0.67, 0.70, 1.0), 0.0, 0.48)
    assign_carrier_material(neutral)
    bpy.context.scene.frame_set(1)

    blend_path = dist_dir / f"{VARIANT_ID}.blend"
    dist_glb = dist_dir / f"{VARIANT_ID}.glb"
    art_glb = art_dir / f"{VARIANT_ID}.glb"
    export_glb(dist_glb)
    export_glb(art_glb)
    previews = render_preview_set(dist_dir)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    write_report(project_root, base_glb, blend_path, dist_glb, art_glb, previews)


def patch_blender_numpy_compat() -> None:
    try:
        import numpy as np
    except ImportError:
        return
    if not hasattr(np, "bool"):
        np.bool = bool


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project-root", default=str(Path(__file__).resolve().parents[1]))
    argv = sys.argv
    script_args = argv[argv.index("--") + 1 :] if "--" in argv else []
    return parser.parse_args(script_args)


def cleanup_stale_generated_textures(art_dir: Path) -> None:
    for path in art_dir.glob(f"{VARIANT_ID}_GR_*"):
        if path.is_file():
            path.unlink()


def first_object_of_type(object_type: str):
    for obj in bpy.context.scene.objects:
        if obj.type == object_type:
            return obj
    return None


def assign_carrier_material(mat: bpy.types.Material) -> None:
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            obj.data.materials.clear()
            obj.data.materials.append(mat)


def make_mat(name: str, base, metallic: float, roughness: float):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = base
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf is not None:
        set_input(bsdf, "Base Color", base)
        set_input(bsdf, "Metallic", metallic)
        set_input(bsdf, "Roughness", roughness)
        set_input(bsdf, "Specular", 0.42)
        set_input(bsdf, "Specular IOR Level", 0.42)
    return mat


def set_input(bsdf, name: str, value) -> None:
    socket = bsdf.inputs.get(name)
    if socket is not None:
        socket.default_value = value


def render_preview_set(dist_dir: Path) -> list[str]:
    setup_preview_scene()
    scene = bpy.context.scene
    camera = scene.camera
    center, extent = scene_bounds()
    target = center
    distance = max(extent.x, extent.y, extent.z, 1.0) * 2.45
    camera.data.ortho_scale = max(extent.z * 1.28, extent.x * 1.90, 2.3)
    views = [
        ("front", Vector((center.x, center.y - distance, center.z))),
        ("side", Vector((center.x + distance, center.y, center.z))),
        ("back", Vector((center.x, center.y + distance, center.z))),
        ("iso", Vector((center.x + distance * 0.75, center.y - distance, center.z + extent.z * 0.55))),
    ]
    paths: list[str] = []
    for label, location in views:
        camera.location = location
        look_at(camera, target)
        output_path = dist_dir / f"{VARIANT_ID}_{label}.png"
        scene.render.filepath = str(output_path)
        bpy.ops.render.render(write_still=True)
        paths.append(str(output_path))
    make_contact_sheet(paths, dist_dir / f"{VARIANT_ID}_contact_sheet.png")
    return [path_relative_to_project(path) for path in paths]


def setup_preview_scene() -> None:
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 640
    scene.render.resolution_y = 840
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Filmic"
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    scene.world = scene.world or bpy.data.worlds.new("EX_preview_world")
    scene.world.color = (0.030, 0.032, 0.034)

    center, extent = scene_bounds()
    floor_z = center.z - extent.z * 0.52
    bpy.ops.mesh.primitive_plane_add(size=max(extent.x, extent.y, 2.6) * 2.1, location=(center.x, center.y, floor_z))
    floor = bpy.context.object
    floor.name = "EX_preview_floor"
    floor.data.materials.append(make_mat("EX_preview_floor_mat", (0.080, 0.084, 0.088, 1), 0.0, 0.72))

    bpy.ops.object.light_add(type="AREA", location=(center.x - 2.6, center.y - 3.2, center.z + 3.0))
    key = bpy.context.object
    key.name = "EX_preview_key_light"
    key.data.energy = 620
    key.data.size = 4.4

    bpy.ops.object.light_add(type="AREA", location=(center.x + 2.2, center.y - 1.8, center.z + 1.8))
    fill = bpy.context.object
    fill.name = "EX_preview_fill_light"
    fill.data.color = (0.74, 0.82, 0.94)
    fill.data.energy = 150
    fill.data.size = 5.0

    bpy.ops.object.camera_add(location=(center.x, center.y - 4, center.z + 1.2))
    camera = bpy.context.object
    camera.name = "EX_preview_camera"
    camera.data.type = "ORTHO"
    scene.camera = camera


def scene_bounds() -> tuple[Vector, Vector]:
    mins = Vector((1e9, 1e9, 1e9))
    maxs = Vector((-1e9, -1e9, -1e9))
    found = False
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj.name.startswith("EX_preview_"):
            continue
        for corner in obj.bound_box:
            world = obj.matrix_world @ Vector(corner)
            mins.x = min(mins.x, world.x)
            mins.y = min(mins.y, world.y)
            mins.z = min(mins.z, world.z)
            maxs.x = max(maxs.x, world.x)
            maxs.y = max(maxs.y, world.y)
            maxs.z = max(maxs.z, world.z)
            found = True
    if not found:
        return Vector((0, 0, 1)), Vector((1, 1, 2))
    center = (mins + maxs) * 0.5
    extent = maxs - mins
    return center, extent


def look_at(obj, target: Vector) -> None:
    direction = target - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def make_contact_sheet(paths: list[str], output_path: Path) -> None:
    montage = shutil.which("montage")
    if montage is None:
        return
    subprocess.run(
        [montage, *paths, "-tile", "2x2", "-geometry", "+10+10", "-background", "#111111", str(output_path)],
        check=True,
    )


def write_report(project_root: Path, base_glb: Path, blend_path: Path, dist_glb: Path, art_glb: Path, previews: list[str]) -> None:
    report_path = dist_glb.parent / f"{VARIANT_ID}_report.json"
    glb_stats = read_glb_stats(dist_glb)
    report = {
        "variant_id": VARIANT_ID,
        "status": "blank_slate_carrier_compiled",
        "source_model": path_relative_to_project(base_glb),
        "implementation_approach": "The Mesh2Motion body, skeleton, and animations are preserved as a neutral carrier with no authored identity modules. This is the reset point for greenfield character modeling experiments.",
        "blender": {
            "compiler": "scripts/build-experiment-blank-blender.py",
            "available_in_this_vm": True,
            "version": bpy.app.version_string,
            "executed": True,
        },
        "artifacts": {
            "blend": path_relative_to_project(blend_path),
            "glb_dist": path_relative_to_project(dist_glb),
            "glb_godot": path_relative_to_project(art_glb),
            "previews": previews,
            "contact_sheet": path_relative_to_project(dist_glb.parent / f"{VARIANT_ID}_contact_sheet.png"),
        },
        "skeleton": {
            "source_skeleton_preserved": True,
            "bone_hierarchy_changed": False,
            "bone_names_changed": False,
        },
        "geometry": {
            "authored_module_count": 0,
            "total_mesh_count": glb_stats["mesh_count"],
            "material_count": glb_stats["material_count"],
            "animation_count": glb_stats["animation_count"],
            "external_textures": False,
            "dist_glb_bytes": dist_glb.stat().st_size if dist_glb.exists() else 0,
        },
        "notes": [
            "This deliberately removes the copied Glitch Reaper identity from the experiment slot.",
            "The showroom still drives the carrier's imported AnimationPlayer clips.",
            "No glitch phase markers are authored for this blank asset.",
        ],
    }
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


def read_glb_stats(path: Path) -> dict[str, int]:
    if not path.exists():
        return {"mesh_count": 0, "material_count": 0, "animation_count": 0}
    data = path.read_bytes()
    if len(data) < 20 or data[:4] != b"glTF":
        return {"mesh_count": 0, "material_count": 0, "animation_count": 0}
    json_length = int.from_bytes(data[12:16], "little")
    gltf = json.loads(data[20 : 20 + json_length].decode("utf-8"))
    return {
        "mesh_count": len(gltf.get("meshes", [])),
        "material_count": len(gltf.get("materials", [])),
        "animation_count": len(gltf.get("animations", [])),
    }


def path_relative_to_project(path_value) -> str:
    path_obj = Path(path_value)
    try:
        return str(path_obj.resolve().relative_to(Path(__file__).resolve().parents[1]))
    except ValueError:
        return str(path_obj)


def export_glb(path: Path) -> None:
    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format="GLB",
        export_animations=True,
        export_apply=False,
        export_yup=True,
    )


if __name__ == "__main__":
    main()
