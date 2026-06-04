#!/usr/bin/env python3
"""Build the experiment slot with a Reallusion CC head transplanted onto Mesh2Motion."""

from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector


VARIANT_ID = "experiment"
REALLUSION_SOURCE_ID = "reallusion_cc3_neutral_template"
CARRIER_HEAD_CUT_Z = 1.505
CC_NECK_COLLAR_MIN_Z = 1.455
MASK_ATLAS_SIZE = 512
MASK_ATLAS_NAME = f"{VARIANT_ID}_skin_masks_{MASK_ATLAS_SIZE}"
MASK_CHANNEL_CONVENTION = {
    "R": "skin_to_muscle_blend",
    "G": "wetness",
    "B": "exposed_bone",
    "A": "blood_clot_glitch_breakup",
}


def main() -> None:
    patch_blender_numpy_compat()
    args = parse_args()
    project_root = Path(args.project_root).resolve()
    base_glb = project_root / "shared-harness/art-kit/characters/camper-mesh2motion-human-base.glb"
    reallusion_fbx = project_root / "shared-harness/art-kit/characters/source/reallusion-cc3-neutral/Base Neutral.fbx"
    dist_dir = project_root / "dist/characters" / VARIANT_ID
    art_dir = project_root / "shared-harness/art-kit/characters/generated"
    dist_dir.mkdir(parents=True, exist_ok=True)
    art_dir.mkdir(parents=True, exist_ok=True)
    (project_root / "dist/characters/.gdignore").write_text(
        "Generated authoring artifacts; runtime assets live under shared-harness.\n",
        encoding="utf-8",
    )
    mask_metadata = build_experiment_mask_atlas(project_root, dist_dir)
    mask_image = bpy.data.images.load(str(mask_metadata["absolute_path"]), check_existing=True)
    mask_image.name = MASK_ATLAS_NAME
    mask_image.colorspace_settings.name = "Non-Color"

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    bpy.ops.import_scene.gltf(filepath=str(base_glb))
    carrier_armature = first_object_of_type("ARMATURE")
    carrier_mesh = first_object_of_type("MESH")
    if carrier_armature is None or carrier_mesh is None:
        raise RuntimeError("Imported Mesh2Motion GLB did not contain the expected armature and mesh")

    mats = make_materials()
    mask_material_uses = apply_mask_atlas_to_materials(mats, mask_image)
    mask_metadata["embedded_materials"] = mask_material_uses
    assign_carrier_material(carrier_mesh, mats["carrier"])
    carrier_head_bounds = high_region_bounds(carrier_mesh, 1.515)
    removed_faces = remove_mannequin_head(carrier_mesh, CARRIER_HEAD_CUT_Z)

    carrier_actions = set(bpy.data.actions)
    imported_before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.fbx(filepath=str(reallusion_fbx))
    imported_objects = [obj for obj in bpy.context.scene.objects if obj not in imported_before]
    cc_body = object_named(imported_objects, "CC_Base_Body")
    if cc_body is None:
        raise RuntimeError("Reallusion FBX did not contain CC_Base_Body")

    head_obj = extract_reallusion_head(cc_body, mats)
    accessory_objects = keep_reallusion_accessories(imported_objects, mats)
    remove_reallusion_source_objects(imported_objects, [head_obj, *accessory_objects])
    remove_imported_actions(carrier_actions)

    transplant_group = [head_obj, *accessory_objects]
    bake_mesh_world_transforms(transplant_group)
    transform_report = fit_reallusion_head_to_carrier(transplant_group, carrier_head_bounds)
    author_integrated_horror_pass(carrier_mesh, head_obj, accessory_objects, mats)
    body_structures = create_body_telefrag_structures(mats)
    for obj in transplant_group:
        bind_to_mesh2motion_armature(obj, carrier_armature)
    for obj in body_structures:
        bind_body_structure_to_mesh2motion_armature(obj, carrier_armature)
        ensure_generated_uv_projection(obj)
    apply_head_vertex_mask(head_obj)
    polish_transplant_objects([carrier_mesh, *transplant_group, *body_structures])

    bpy.context.scene.frame_set(1)
    blend_path = dist_dir / f"{VARIANT_ID}.blend"
    dist_glb = dist_dir / f"{VARIANT_ID}.glb"
    art_glb = art_dir / f"{VARIANT_ID}.glb"
    export_glb(dist_glb)
    export_glb(art_glb)
    previews = render_preview_set(dist_dir)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    write_report(
        project_root,
        base_glb,
        reallusion_fbx,
        blend_path,
        dist_glb,
        art_glb,
        previews,
        removed_faces,
        transplant_group,
        body_structures,
        transform_report,
        mask_metadata,
    )


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


def build_experiment_mask_atlas(project_root: Path, dist_dir: Path) -> dict:
    source_dir = project_root / "shared-harness/art-kit/characters/library/masks"
    source_paths = {
        "cellular_noise": source_dir / "cellular_noise_512.png",
        "tear_edge": source_dir / "tear_edge_512.png",
        "vein_noise": source_dir / "vein_noise_512.png",
        "clot_breakup": source_dir / "clot_breakup_512.png",
    }
    missing = [path for path in source_paths.values() if not path.exists()]
    if missing:
        raise RuntimeError(f"Experiment mask atlas source masks missing: {[str(path) for path in missing]}")

    source_pixels = {
        name: load_grayscale_mask(path, MASK_ATLAS_SIZE)
        for name, path in source_paths.items()
    }
    cellular = source_pixels["cellular_noise"]
    tear = source_pixels["tear_edge"]
    vein = source_pixels["vein_noise"]
    clot = source_pixels["clot_breakup"]

    flat_pixels: list[float] = []
    preview_pixels: list[float] = []
    channel_values = {"R": [], "G": [], "B": [], "A": []}
    size = MASK_ATLAS_SIZE
    for index in range(size * size):
        x = index % size
        y = index // size
        u = x / max(1, size - 1)
        v = y / max(1, size - 1)
        radial = math.hypot(u - 0.52, v - 0.54)
        diagonal = 0.5 + 0.5 * math.sin((u * 7.3 + v * 5.1) * math.tau)
        torn_edge = smoothstep(0.18, 0.92, tear[index])
        cellular_break = smoothstep(0.28, 0.86, cellular[index])
        vein_trace = smoothstep(0.33, 0.96, vein[index])
        clot_trace = smoothstep(0.24, 0.95, clot[index])
        radial_falloff = max(0.0, 1.0 - min(radial / 0.72, 1.0))

        r = clamp01(0.22 + torn_edge * 0.54 + vein_trace * 0.18 + diagonal * 0.08)
        g = clamp01(0.12 + vein_trace * 0.52 + clot_trace * 0.22 + cellular_break * 0.16)
        b = clamp01(0.06 + max(torn_edge - cellular_break * 0.34, 0.0) * 0.70 + radial_falloff * 0.12)
        a = clamp01(0.18 + clot_trace * 0.62 + cellular_break * 0.24 + (1.0 - radial_falloff) * 0.08)

        flat_pixels.extend((r, g, b, a))
        channel_values["R"].append(r)
        channel_values["G"].append(g)
        channel_values["B"].append(b)
        channel_values["A"].append(a)

        if x < size // 2 and y >= size // 2:
            preview_pixels.extend((r, 0.0, 0.0, 1.0))
        elif x >= size // 2 and y >= size // 2:
            preview_pixels.extend((0.0, g, 0.0, 1.0))
        elif x < size // 2:
            preview_pixels.extend((0.0, 0.0, b, 1.0))
        else:
            preview_pixels.extend((a, 0.0, a, 1.0))

    atlas_path = dist_dir / f"{MASK_ATLAS_NAME}.png"
    preview_path = dist_dir / f"{MASK_ATLAS_NAME}_preview.png"
    save_float_rgba_png(MASK_ATLAS_NAME, MASK_ATLAS_SIZE, MASK_ATLAS_SIZE, flat_pixels, atlas_path)
    save_float_rgba_png(f"{MASK_ATLAS_NAME}_preview", MASK_ATLAS_SIZE, MASK_ATLAS_SIZE, preview_pixels, preview_path)
    return {
        "absolute_path": atlas_path,
        "path": path_relative_to_project(atlas_path),
        "preview": path_relative_to_project(preview_path),
        "dimensions": [MASK_ATLAS_SIZE, MASK_ATLAS_SIZE],
        "format": "RGBA PNG",
        "channel_convention": MASK_CHANNEL_CONVENTION,
        "source_masks": {
            name: path_relative_to_project(path)
            for name, path in source_paths.items()
        },
        "channel_stats": {
            channel: channel_stat(values)
            for channel, values in channel_values.items()
        },
        "validation": {
            "channels_nonblank": all(channel_stat(values)["nonblank"] for values in channel_values.values()),
            "expected_size": [MASK_ATLAS_SIZE, MASK_ATLAS_SIZE],
        },
        "usage": "Mixed into selected wound/glitch material colors for breakup; G also modulates wetness/roughness on wet materials.",
    }


def load_grayscale_mask(path: Path, expected_size: int) -> list[float]:
    image = bpy.data.images.load(str(path), check_existing=True)
    image.colorspace_settings.name = "Non-Color"
    width, height = image.size
    if width != expected_size or height != expected_size:
        raise RuntimeError(f"Mask {path.name} is {width}x{height}; expected {expected_size}x{expected_size}")
    pixels = list(image.pixels[:])
    values: list[float] = []
    for index in range(0, len(pixels), 4):
        values.append((pixels[index] + pixels[index + 1] + pixels[index + 2]) / 3.0)
    return values


def save_float_rgba_png(name: str, width: int, height: int, pixels: list[float], path: Path) -> None:
    image = bpy.data.images.new(name=name, width=width, height=height, alpha=True, float_buffer=False)
    image.colorspace_settings.name = "Non-Color"
    image.pixels.foreach_set(pixels)
    image.filepath_raw = str(path)
    image.file_format = "PNG"
    image.save()


def channel_stat(values: list[float]) -> dict:
    if not values:
        return {"min": 0, "max": 0, "mean": 0, "nonblank": False}
    minimum = min(values)
    maximum = max(values)
    mean = sum(values) / len(values)
    return {
        "min": round(minimum, 5),
        "max": round(maximum, 5),
        "mean": round(mean, 5),
        "nonblank": maximum - minimum > 0.015 and maximum > 0.04,
    }


def smoothstep(edge0: float, edge1: float, value: float) -> float:
    if edge0 == edge1:
        return 1.0 if value >= edge1 else 0.0
    t = clamp01((value - edge0) / (edge1 - edge0))
    return t * t * (3.0 - 2.0 * t)


def clamp01(value: float) -> float:
    return max(0.0, min(1.0, value))


def first_object_of_type(object_type: str):
    for obj in bpy.context.scene.objects:
        if obj.type == object_type:
            return obj
    return None


def object_named(objects: list[bpy.types.Object], name: str):
    for obj in objects:
        if obj.name == name:
            return obj
    return None


def make_materials() -> dict[str, bpy.types.Material]:
    return {
        "carrier": make_mat("EX_body_burnished_gunmetal", (0.225, 0.270, 0.270, 1.0), 0.72, 0.34),
        "carrier_shadow": make_mat("EX_body_deep_joint_shadow", (0.030, 0.034, 0.036, 1.0), 0.55, 0.46),
        "head_skin": make_mat("EX_head_pallid_necrotic_skin", (0.190, 0.205, 0.198, 1.0), 0.0, 0.60),
        "phase_skin": make_mat("EX_transient_human_phase_skin", (0.128, 0.137, 0.130, 1.0), 0.0, 0.55),
        "neck_skin": make_mat("EX_neck_torn_skin_edge", (0.086, 0.034, 0.032, 1.0), 0.0, 0.40),
        "scar_edge": make_mat("EX_livid_torn_transition_skin", (0.050, 0.014, 0.012, 1.0), 0.0, 0.40),
        "muscle": make_mat("EX_subdermal_wet_muscle", (0.046, 0.006, 0.005, 1.0), 0.0, 0.20),
        "muscle_gloss": make_mat("EX_subdermal_wet_muscle_gloss", (0.066, 0.010, 0.008, 1.0), 0.0, 0.14),
        "clot": make_mat("EX_clotted_black_blood", (0.040, 0.004, 0.003, 1.0), 0.0, 0.18),
        "tendon": make_mat("EX_frayed_tendon_strand", (0.095, 0.050, 0.037, 1.0), 0.0, 0.36),
        "bone": make_mat("EX_sick_exposed_bone", (0.285, 0.255, 0.205, 1.0), 0.0, 0.66),
        "cyber_metal": make_mat("EX_necron_oxidized_cybermetal", (0.130, 0.210, 0.205, 1.0), 0.88, 0.27),
        "metal_edge": make_mat("EX_burnished_cut_metal_edge", (0.300, 0.350, 0.340, 1.0), 0.92, 0.20),
        "copper": make_mat("EX_copper_patina_corrosion", (0.205, 0.100, 0.055, 1.0), 0.82, 0.34),
        "green_glow": make_mat("EX_sparse_molten_green_fissure", (0.004, 0.066, 0.044, 1.0), 0.0, 0.20, (0.035, 0.46, 0.27), 0.42),
        "eyelash": make_mat("EX_reallusion_eyelash_dark", (0.015, 0.012, 0.010, 1.0), 0.0, 0.68),
        "eye": make_mat("EX_milky_green_machine_eye", (0.34, 0.58, 0.50, 1.0), 0.0, 0.10, (0.055, 0.55, 0.31), 0.34),
        "optic_dark": make_mat("EX_recessed_black_optic_core", (0.003, 0.010, 0.008, 1.0), 0.0, 0.05, (0.00, 0.16, 0.08), 0.20),
        "teeth": make_mat("EX_reallusion_teeth_bone_probe", (0.70, 0.66, 0.56, 1.0), 0.0, 0.52),
        "tongue": make_mat("EX_reallusion_tongue_probe", (0.45, 0.12, 0.13, 1.0), 0.0, 0.30),
    }


def make_mat(name: str, base, metallic: float, roughness: float, emission=None, energy: float = 0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = base
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf is not None:
        set_input(bsdf, "Base Color", base)
        set_input(bsdf, "Metallic", metallic)
        set_input(bsdf, "Roughness", roughness)
        set_input(bsdf, "Specular", 0.45)
        set_input(bsdf, "Specular IOR Level", 0.45)
        if "muscle" in name or "blood" in name or "eye" in name or "tendon" in name:
            wetness = 0.52 if "gloss" in name else 0.36
            coat_roughness = 0.11 if "gloss" in name else 0.20
            set_input(bsdf, "Clearcoat", wetness)
            set_input(bsdf, "Coat Weight", wetness)
            set_input(bsdf, "Clearcoat Roughness", coat_roughness)
            set_input(bsdf, "Coat Roughness", coat_roughness)
        if emission is not None:
            emission_color = (emission[0], emission[1], emission[2], 1.0) if len(emission) == 3 else emission
            set_input(bsdf, "Emission", emission_color)
            set_input(bsdf, "Emission Color", emission_color)
            set_input(bsdf, "Emission Strength", energy)
    return mat


def apply_mask_atlas_to_materials(
    mats: dict[str, bpy.types.Material],
    mask_image: bpy.types.Image,
) -> list[str]:
    material_keys = [
        "neck_skin",
        "scar_edge",
        "muscle",
        "muscle_gloss",
        "clot",
        "tendon",
        "green_glow",
    ]
    embedded_materials: list[str] = []
    for key in material_keys:
        mat = mats.get(key)
        if mat is None:
            continue
        apply_mask_atlas_to_material(mat, mask_image, key)
        embedded_materials.append(mat.name)
    return embedded_materials


def apply_mask_atlas_to_material(
    mat: bpy.types.Material,
    mask_image: bpy.types.Image,
    material_key: str,
) -> None:
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    if bsdf is None:
        return

    texture = nodes.new(type="ShaderNodeTexImage")
    texture.name = f"EX_{material_key}_packed_mask_atlas"
    texture.label = "experiment packed RGBA mask atlas"
    texture.image = mask_image
    texture.extension = "REPEAT"
    texture.interpolation = "Cubic"
    base_color = bsdf.inputs.get("Base Color")
    if base_color is not None:
        mix = nodes.new(type="ShaderNodeMixRGB")
        mix.name = f"EX_{material_key}_mask_color_breakup"
        mix.blend_type = "MULTIPLY"
        mix.inputs[0].default_value = 0.38 if material_key != "green_glow" else 0.22
        mix.inputs[1].default_value = mat.diffuse_color
        links.new(texture.outputs["Color"], mix.inputs[2])
        links.new(mix.outputs["Color"], base_color)

    if material_key in {"neck_skin", "scar_edge", "muscle", "muscle_gloss", "clot", "tendon"}:
        separate = nodes.new(type="ShaderNodeSeparateRGB")
        links.new(texture.outputs["Color"], separate.inputs["Image"])
        roughness = bsdf.inputs.get("Roughness")
        if roughness is not None:
            roughness_map = nodes.new(type="ShaderNodeMapRange")
            roughness_map.inputs["From Min"].default_value = 0.0
            roughness_map.inputs["From Max"].default_value = 1.0
            roughness_map.inputs["To Min"].default_value = 0.42
            roughness_map.inputs["To Max"].default_value = 0.08
            links.new(separate.outputs["G"], roughness_map.inputs["Value"])
            links.new(roughness_map.outputs["Result"], roughness)
        if material_key in {"muscle", "muscle_gloss", "clot"}:
            set_input(bsdf, "Clearcoat", 0.46)
            set_input(bsdf, "Coat Weight", 0.46)
            set_input(bsdf, "Clearcoat Roughness", 0.12)
            set_input(bsdf, "Coat Roughness", 0.12)


def set_input(bsdf, name: str, value) -> None:
    socket = bsdf.inputs.get(name)
    if socket is not None:
        socket.default_value = value


def assign_carrier_material(carrier_mesh: bpy.types.Object, mat: bpy.types.Material) -> None:
    carrier_mesh.data.materials.clear()
    carrier_mesh.data.materials.append(mat)


def remove_mannequin_head(carrier_mesh: bpy.types.Object, cutoff_z: float) -> int:
    removed = 0
    mesh = carrier_mesh.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()
    faces_to_delete = []
    for face in bm.faces:
        center = carrier_mesh.matrix_world @ face.calc_center_median()
        if center.z > cutoff_z and abs(center.x) < 0.18:
            faces_to_delete.append(face)
    removed = len(faces_to_delete)
    bmesh.ops.delete(bm, geom=faces_to_delete, context="FACES")
    loose_vertices = [vertex for vertex in bm.verts if not vertex.link_faces]
    if loose_vertices:
        bmesh.ops.delete(bm, geom=loose_vertices, context="VERTS")
    bm.to_mesh(mesh)
    bm.free()
    carrier_mesh.data.update()
    return removed


def extract_reallusion_head(cc_body: bpy.types.Object, mats: dict[str, bpy.types.Material]) -> bpy.types.Object:
    head = cc_body.copy()
    head.data = cc_body.data.copy()
    head.animation_data_clear()
    head.name = "experiment_reallusion_integrated_head"
    head.data.name = "experiment_reallusion_integrated_head_mesh"
    bpy.context.collection.objects.link(head)
    for modifier in list(head.modifiers):
        head.modifiers.remove(modifier)
    world_matrix = head.matrix_world.copy()
    head.parent = None
    head.matrix_world = world_matrix

    original_mats = [mat.name if mat else "" for mat in head.data.materials]
    head.data.materials.clear()
    for mat_name in original_mats:
        if mat_name == "Eyelash":
            head.data.materials.append(mats["eyelash"])
        elif mat_name == "Skin_Body":
            head.data.materials.append(mats["neck_skin"])
        else:
            head.data.materials.append(mats["head_skin"])

    mesh = head.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()
    faces_to_delete = []
    for face in bm.faces:
        mat_name = original_mats[face.material_index] if face.material_index < len(original_mats) else ""
        center = head.matrix_world @ face.calc_center_median()
        keep_head = mat_name in ["Skin_Head", "Eyelash"]
        keep_neck = (
            mat_name == "Skin_Body"
            and center.z >= CC_NECK_COLLAR_MIN_Z
            and abs(center.x) <= 0.125
            and -0.080 <= center.y <= 0.165
        )
        if not (keep_head or keep_neck):
            faces_to_delete.append(face)
    bmesh.ops.delete(bm, geom=faces_to_delete, context="FACES")
    loose_vertices = [vertex for vertex in bm.verts if not vertex.link_faces]
    if loose_vertices:
        bmesh.ops.delete(bm, geom=loose_vertices, context="VERTS")
    bm.to_mesh(mesh)
    bm.free()
    head.data.update()
    return head


def keep_reallusion_accessories(imported_objects: list[bpy.types.Object], mats: dict[str, bpy.types.Material]) -> list[bpy.types.Object]:
    kept = []
    for source_name, material_key, output_name in [
        ("CC_Base_Eye", "eye", "experiment_reallusion_eyes"),
        ("CC_Base_Teeth", "teeth", "experiment_reallusion_teeth"),
        ("CC_Base_Tongue", "tongue", "experiment_reallusion_tongue"),
    ]:
        obj = object_named(imported_objects, source_name)
        if obj is None:
            continue
        obj.name = output_name
        obj.data.name = f"{output_name}_mesh"
        for modifier in list(obj.modifiers):
            obj.modifiers.remove(modifier)
        world_matrix = obj.matrix_world.copy()
        obj.parent = None
        obj.matrix_world = world_matrix
        obj.data.materials.clear()
        obj.data.materials.append(mats[material_key])
        kept.append(obj)
    return kept


def remove_reallusion_source_objects(imported_objects: list[bpy.types.Object], keep: list[bpy.types.Object]) -> None:
    keep_set = set(keep)
    for obj in imported_objects:
        if obj in keep_set:
            continue
        bpy.data.objects.remove(obj, do_unlink=True)


def remove_imported_actions(carrier_actions: set[bpy.types.Action]) -> None:
    for action in list(bpy.data.actions):
        if action not in carrier_actions:
            bpy.data.actions.remove(action)


def high_region_bounds(obj: bpy.types.Object, min_z: float) -> dict[str, list[float]]:
    points = []
    for poly in obj.data.polygons:
        center = obj.matrix_world @ poly.center
        if center.z < min_z or abs(center.x) > 0.22:
            continue
        for vertex_index in poly.vertices:
            points.append(obj.matrix_world @ obj.data.vertices[vertex_index].co)
    if not points:
        return object_bounds(obj)
    return bounds_from_points(points)


def object_bounds(obj: bpy.types.Object) -> dict[str, list[float]]:
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return bounds_from_points(points)


def group_bounds(objects: list[bpy.types.Object]) -> dict[str, list[float]]:
    points = []
    for obj in objects:
        if obj.type != "MESH":
            continue
        points.extend(obj.matrix_world @ vertex.co for vertex in obj.data.vertices)
    return bounds_from_points(points)


def bake_mesh_world_transforms(objects: list[bpy.types.Object]) -> None:
    for obj in objects:
        if obj.type != "MESH":
            continue
        obj.data.transform(obj.matrix_world)
        obj.matrix_world = Matrix.Identity(4)
        obj.data.update()


def bounds_from_points(points: list[Vector]) -> dict[str, list[float]]:
    mins = Vector((min(p.x for p in points), min(p.y for p in points), min(p.z for p in points)))
    maxs = Vector((max(p.x for p in points), max(p.y for p in points), max(p.z for p in points)))
    center = (mins + maxs) * 0.5
    return {
        "min": [mins.x, mins.y, mins.z],
        "max": [maxs.x, maxs.y, maxs.z],
        "center": [center.x, center.y, center.z],
        "size": [maxs.x - mins.x, maxs.y - mins.y, maxs.z - mins.z],
    }


def fit_reallusion_head_to_carrier(objects: list[bpy.types.Object], target_bounds: dict[str, list[float]]) -> dict:
    source = group_bounds(objects)
    source_min = Vector(source["min"])
    source_max = Vector(source["max"])
    source_center = Vector(source["center"])
    target_min = Vector(target_bounds["min"])
    target_max = Vector(target_bounds["max"])
    target_center = Vector(target_bounds["center"])
    target_lower_z = 1.455
    source_height = max(source_max.z - source_min.z, 0.001)
    target_height = max(target_max.z - target_lower_z, 0.001)
    scale = max(0.92, min(1.08, target_height / source_height))
    target_center.x -= 0.012
    target_center.y -= 0.010
    target_anchor = Vector((target_center.x, target_center.y, target_lower_z))
    source_anchor = Vector((source_center.x, source_center.y, source_min.z))
    transform = Matrix.Translation(target_anchor) @ Matrix.Scale(scale, 4) @ Matrix.Translation(-source_anchor)
    for obj in objects:
        obj.data.transform(transform)
        obj.matrix_world = Matrix.Identity(4)
        obj.data.update()
    fitted = group_bounds(objects)
    return {
        "source_bounds": rounded_bounds(source),
        "target_bounds": rounded_bounds(target_bounds),
        "fitted_bounds": rounded_bounds(fitted),
        "scale": round(scale, 5),
        "target_lower_z": target_lower_z,
    }


def rounded_bounds(bounds: dict[str, list[float]]) -> dict[str, list[float]]:
    return {key: [round(value, 5) for value in values] for key, values in bounds.items()}


def bind_to_mesh2motion_armature(obj: bpy.types.Object, armature: bpy.types.Object) -> None:
    obj.vertex_groups.clear()
    head_group = obj.vertex_groups.new(name="head")
    neck_group = obj.vertex_groups.new(name="neck_01")
    z_values = [(obj.matrix_world @ vertex.co).z for vertex in obj.data.vertices]
    for vertex, world_z in zip(obj.data.vertices, z_values):
        if obj.name == "experiment_reallusion_integrated_head":
            blend = max(0.0, min(1.0, (world_z - 1.525) / 0.075))
            head_weight = blend
            neck_weight = 1.0 - blend
        else:
            head_weight = 1.0
            neck_weight = 0.0
        head_group.add([vertex.index], head_weight, "REPLACE")
        if neck_weight > 0.0:
            neck_group.add([vertex.index], neck_weight, "REPLACE")
    modifier = obj.modifiers.new(name="EX_mesh2motion_head_bind", type="ARMATURE")
    modifier.object = armature
    obj.parent = armature


def bind_body_structure_to_mesh2motion_armature(obj: bpy.types.Object, armature: bpy.types.Object) -> None:
    obj.vertex_groups.clear()
    bone_names = {bone.name for bone in armature.data.bones}
    spine_01 = first_available_bone(bone_names, ["spine_01", "Spine", "mixamorig:Spine"])
    spine_02 = first_available_bone(bone_names, ["spine_02", "Spine1", "mixamorig:Spine1", spine_01])
    spine_03 = first_available_bone(bone_names, ["spine_03", "Spine2", "mixamorig:Spine2", spine_02])
    neck_01 = first_available_bone(bone_names, ["neck_01", "Neck", "mixamorig:Neck", spine_03])
    groups = {
        spine_01: obj.vertex_groups.new(name=spine_01),
        spine_02: obj.vertex_groups.new(name=spine_02),
        spine_03: obj.vertex_groups.new(name=spine_03),
        neck_01: obj.vertex_groups.new(name=neck_01),
    }
    for vertex in obj.data.vertices:
        world_z = (obj.matrix_world @ vertex.co).z
        if world_z > 1.500:
            groups[neck_01].add([vertex.index], 0.68, "REPLACE")
            groups[spine_03].add([vertex.index], 0.32, "REPLACE")
        elif world_z > 1.300:
            upper_blend = max(0.0, min(1.0, (world_z - 1.300) / 0.200))
            groups[spine_03].add([vertex.index], 0.72 + 0.28 * upper_blend, "REPLACE")
            groups[spine_02].add([vertex.index], 0.28 * (1.0 - upper_blend), "REPLACE")
        elif world_z > 0.980:
            mid_blend = max(0.0, min(1.0, (world_z - 0.980) / 0.320))
            groups[spine_02].add([vertex.index], 0.55 + 0.35 * mid_blend, "REPLACE")
            groups[spine_01].add([vertex.index], 0.45 * (1.0 - mid_blend), "REPLACE")
        else:
            groups[spine_01].add([vertex.index], 1.0, "REPLACE")
    modifier = obj.modifiers.new(name="EX_mesh2motion_torso_bind", type="ARMATURE")
    modifier.object = armature
    obj.parent = armature


def first_available_bone(bone_names: set[str], candidates: list[str]) -> str:
    for candidate in candidates:
        if candidate in bone_names:
            return candidate
    return candidates[-1]


def apply_head_vertex_mask(head_obj: bpy.types.Object) -> None:
    color_attr = head_obj.data.color_attributes.new(name="rl_head_region_mask", type="BYTE_COLOR", domain="CORNER")
    for poly in head_obj.data.polygons:
        center = head_obj.matrix_world @ poly.center
        is_neck = center.z < 1.535
        is_mouth_zone = center.y < -0.030 and 1.585 < center.z < 1.650
        is_eye_zone = center.y < -0.020 and 1.655 < center.z < 1.710
        color = (
            0.18 if is_neck else 0.0,
            0.72 if is_eye_zone else 0.10,
            0.58 if is_mouth_zone else 0.0,
            1.0,
        )
        for loop_index in poly.loop_indices:
            color_attr.data[loop_index].color = color


def author_integrated_horror_pass(
    carrier_mesh: bpy.types.Object,
    head_obj: bpy.types.Object,
    accessory_objects: list[bpy.types.Object],
    mats: dict[str, bpy.types.Material],
) -> None:
    assign_body_material_regions(carrier_mesh, mats)
    assign_head_material_regions(head_obj, mats)
    sculpt_head_asymmetry(head_obj)
    sculpt_body_glitch_offsets(carrier_mesh)
    tone_accessories(accessory_objects, mats)


def material_slot(obj: bpy.types.Object, mat: bpy.types.Material) -> int:
    for index, existing in enumerate(obj.data.materials):
        if existing == mat or (existing is not None and existing.name == mat.name):
            return index
    obj.data.materials.append(mat)
    return len(obj.data.materials) - 1


def assign_body_material_regions(carrier_mesh: bpy.types.Object, mats: dict[str, bpy.types.Material]) -> None:
    slots = {
        "carrier": material_slot(carrier_mesh, mats["carrier"]),
        "shadow": material_slot(carrier_mesh, mats["carrier_shadow"]),
        "phase_skin": material_slot(carrier_mesh, mats["phase_skin"]),
        "scar": material_slot(carrier_mesh, mats["scar_edge"]),
        "muscle": material_slot(carrier_mesh, mats["muscle"]),
        "muscle_gloss": material_slot(carrier_mesh, mats["muscle_gloss"]),
        "clot": material_slot(carrier_mesh, mats["clot"]),
        "tendon": material_slot(carrier_mesh, mats["tendon"]),
        "bone": material_slot(carrier_mesh, mats["bone"]),
        "cyber": material_slot(carrier_mesh, mats["cyber_metal"]),
        "metal_edge": material_slot(carrier_mesh, mats["metal_edge"]),
        "copper": material_slot(carrier_mesh, mats["copper"]),
        "green": material_slot(carrier_mesh, mats["green_glow"]),
    }
    for poly in carrier_mesh.data.polygons:
        center = carrier_mesh.matrix_world @ poly.center
        front = center.y < -0.012
        back = center.y > 0.046
        poly.material_index = slots["carrier"]
        if is_dark_joint_region(center):
            poly.material_index = slots["shadow"]

        sternum_value = ellipsoid(center, (0.038, -0.060, 1.455), (0.052, 0.038, 0.044))
        clavicle_value = ellipsoid(center, (0.010, -0.045, 1.505), (0.070, 0.028, 0.017))
        chest_cavity_value = ellipsoid(center, (0.032, -0.062, 1.438), (0.056, 0.041, 0.060))
        sternum_outer = front and ragged_value(sternum_value, center, 0.92, 1.18, 0.040, 32)
        sternum_edge = front and ragged_value(sternum_value, center, 0.58, 0.92, 0.040, 2)
        sternum_wound = front and ragged_value(sternum_value, center, 0.0, 0.36, 0.035, 3)
        chest_cavity_outer = front and ragged_value(chest_cavity_value, center, 0.92, 1.22, 0.045, 33)
        chest_cavity_edge = front and ragged_value(chest_cavity_value, center, 0.58, 0.92, 0.045, 16)
        chest_cavity_core = front and ragged_value(chest_cavity_value, center, 0.0, 0.34, 0.035, 17)
        clavicle_outer = front and ragged_value(clavicle_value, center, 0.92, 1.18, 0.040, 34)
        clavicle_edge = front and ragged_value(clavicle_value, center, 0.58, 0.92, 0.040, 4)
        clavicle_tear = front and ragged_value(clavicle_value, center, 0.0, 0.36, 0.035, 5)
        cyber_breastplate_value = ellipsoid(center, (-0.083, -0.040, 1.305), (0.066, 0.054, 0.088))
        cyber_breastplate_outer = front and ragged_value(cyber_breastplate_value, center, 0.88, 1.18, 0.040, 35)
        cyber_breastplate_edge = front and ragged_value(cyber_breastplate_value, center, 0.58, 0.88, 0.045, 18)
        cyber_breastplate = front and ragged_value(cyber_breastplate_value, center, 0.0, 0.44, 0.035, 19)
        rear_spine_edge = back and 0.96 < center.z < 1.595 and abs(center.x - rear_spine_wave(center)) < 0.032
        rear_spine = back and 0.96 < center.z < 1.595 and abs(center.x - rear_spine_wave(center)) < 0.018
        rear_left_tear = back and center.x < -0.120 and 1.07 < center.z < 1.48
        left_limb_corruption = center.x < -0.145 and 0.72 < center.z < 1.50
        right_limb_patina = center.x > 0.145 and 0.78 < center.z < 1.44
        throat_socket = front and diagonal_band_xz(center, (-0.004, 1.520), (0.018, 1.405), 0.030) and center.y < -0.020
        left_cyber_rib_frame = front and any(
            diagonal_band_xz(center, (-0.012, 1.472 - step * 0.032), (-0.128, 1.438 - step * 0.038), 0.011)
            for step in range(4)
        )
        right_tendon_rib_frame = front and any(
            diagonal_band_xz(center, (0.010, 1.456 - step * 0.031), (0.118, 1.425 - step * 0.035), 0.010)
            for step in range(4)
        )
        rear_scapula_frame = back and 1.145 < center.z < 1.520 and 0.060 < abs(center.x) < 0.160 and abs(center.y) < 0.105
        rear_scapula_frame = rear_scapula_frame and (
            abs(abs(center.x) - (0.112 - 0.050 * abs(center.z - 1.335))) < 0.026
        )
        side_graft_channel = abs(center.x) > 0.168 and 1.055 < center.z < 1.430 and -0.030 < center.y < 0.070
        telefrag_core_value = ellipsoid(center, (0.023, -0.064, 1.402), (0.078, 0.046, 0.100))
        telefrag_outer = front and ragged_value(telefrag_core_value, center, 0.88, 1.20, 0.035, 41)
        telefrag_edge = front and ragged_value(telefrag_core_value, center, 0.60, 0.88, 0.030, 42)
        telefrag_core = front and ragged_value(telefrag_core_value, center, 0.0, 0.64, 0.025, 43)
        telefrag_left_clamp = front and any(
            diagonal_band_xz(center, (-0.006, 1.452 - step * 0.034), (-0.104, 1.478 - step * 0.048), 0.013)
            for step in range(4)
        )
        telefrag_right_sinew = front and any(
            diagonal_band_xz(center, (0.024, 1.440 - step * 0.034), (0.122, 1.468 - step * 0.047), 0.012)
            for step in range(4)
        )
        left_chest_shell = front and ragged_value(
            ellipsoid(center, (-0.062, -0.052, 1.405), (0.090, 0.046, 0.112)),
            center,
            0.0,
            0.54,
            0.035,
            29,
        )
        left_chest_shell_feather = front and ragged_value(
            ellipsoid(center, (-0.062, -0.052, 1.405), (0.094, 0.049, 0.116)),
            center,
            0.56,
            0.94,
            0.045,
            36,
        )

        if sternum_outer or chest_cavity_outer or clavicle_outer:
            poly.material_index = slots["phase_skin"] if center.x > -0.030 else slots["metal_edge"]
            if sparse_cell(center, 14):
                poly.material_index = slots["scar"]
        if cyber_breastplate_outer:
            poly.material_index = slots["metal_edge"] if sparse_cell(center, 3) else slots["cyber"]
        if cyber_breastplate_edge:
            poly.material_index = slots["metal_edge"] if not sparse_cell(center, 9) else slots["copper"]
        if cyber_breastplate:
            poly.material_index = slots["cyber"]
            if copper_transition(center, (-0.070, -0.040, 1.325), (0.116, 0.078, 0.146)) and sparse_cell(center, 2):
                poly.material_index = slots["copper"]
        if left_cyber_rib_frame:
            poly.material_index = slots["cyber"]
            if sparse_cell(center, 9):
                poly.material_index = slots["copper"]
        if right_tendon_rib_frame:
            poly.material_index = slots["tendon"] if not sparse_cell(center, 5) else slots["muscle_gloss"]
        if throat_socket:
            poly.material_index = slots["muscle"]
            if abs(center.x - 0.006) < 0.011:
                poly.material_index = slots["clot"]
            if sparse_cell(center, 6) and center.z > 1.455:
                poly.material_index = slots["green"]
        if chest_cavity_edge:
            poly.material_index = slots["scar"]
            if sparse_cell(center, 11):
                poly.material_index = slots["metal_edge"]
        if clavicle_edge or sternum_edge:
            poly.material_index = slots["scar"] if not sparse_cell(center, 6) else slots["phase_skin"]
            if sparse_cell(center, 17):
                poly.material_index = slots["clot"]
        if clavicle_tear:
            poly.material_index = slots["muscle"] if center.x > -0.028 else slots["cyber"]
            if abs(center.x - 0.010) < 0.017 and center.z < 1.509:
                poly.material_index = slots["tendon"] if sparse_cell(center, 4) else slots["clot"]
            if abs(center.x - 0.006) < 0.006 and center.z < 1.500 and sparse_cell(center, 5):
                poly.material_index = slots["bone"]
        if chest_cavity_core:
            poly.material_index = slots["muscle"]
            if wet_highlight_cell(center):
                poly.material_index = slots["muscle_gloss"]
            if diagonal_band_xz(center, (0.008, 1.492), (0.060, 1.370), 0.008):
                poly.material_index = slots["tendon"]
            if abs((center.x - 0.022) + 0.20 * (center.z - 1.438)) < 0.004 and sparse_cell(center, 7):
                poly.material_index = slots["bone"]
        if sternum_wound:
            poly.material_index = slots["muscle"]
            if ellipsoid(center, (0.050, -0.068, 1.435), (0.039, 0.030, 0.037)) < 1.0:
                poly.material_index = slots["clot"]
            if wet_highlight_cell(center):
                poly.material_index = slots["muscle_gloss"]
            if abs((center.x - 0.045) + 0.24 * (center.z - 1.448)) < 0.008 and sparse_cell(center, 5):
                poly.material_index = slots["tendon"]
            if sternum_fissure(center):
                poly.material_index = slots["green"]
        if rear_spine_edge:
            poly.material_index = slots["cyber"] if not sparse_cell(center, 5) else slots["clot"]
        if rear_spine:
            poly.material_index = slots["green"] if rear_fissure(center) else slots["cyber"]
        if rear_scapula_frame:
            poly.material_index = slots["cyber"] if not sparse_cell(center, 10) else slots["copper"]
            if abs(center.x - rear_spine_wave(center)) < 0.040 and sparse_cell(center, 4):
                poly.material_index = slots["green"]
        if rear_left_tear:
            poly.material_index = slots["cyber"] if not sparse_cell(center, 10) else slots["copper"]
        if side_graft_channel:
            poly.material_index = slots["cyber"] if center.x < 0.0 else slots["tendon"]
            if sparse_cell(center, 9):
                poly.material_index = slots["copper"] if center.x < 0.0 else slots["clot"]
        if left_limb_corruption:
            poly.material_index = slots["cyber"] if not sparse_cell(center, 11) else slots["copper"]
        if right_limb_patina and sparse_cell(center, 14):
            poly.material_index = slots["copper"]
        if left_chest_shell_feather and not throat_socket and not chest_cavity_core and not chest_cavity_edge:
            poly.material_index = slots["metal_edge"] if not sparse_cell(center, 5) else slots["phase_skin"]
        if left_chest_shell and not throat_socket and not chest_cavity_core:
            poly.material_index = slots["cyber"]
            if center.z > 1.460 and sparse_cell(center, 8):
                poly.material_index = slots["metal_edge"]
            elif center.x < -0.105 and sparse_cell(center, 12):
                poly.material_index = slots["copper"]
        if telefrag_outer:
            poly.material_index = slots["metal_edge"] if center.x < 0.020 else slots["scar"]
            if sparse_cell(center, 7):
                poly.material_index = slots["cyber"] if center.x < 0.020 else slots["phase_skin"]
        if telefrag_edge:
            poly.material_index = slots["cyber"] if center.x < 0.016 else slots["tendon"]
            if abs(center.x - 0.022) < 0.018 and sparse_cell(center, 9):
                poly.material_index = slots["metal_edge"]
        if telefrag_core:
            poly.material_index = slots["clot"] if center.x < 0.036 else slots["muscle"]
            if wet_highlight_cell(center):
                poly.material_index = slots["muscle_gloss"]
            if telefrag_sternum_fissure(center):
                poly.material_index = slots["green"]
            elif telefrag_sternum_bone(center):
                poly.material_index = slots["bone"]
        if telefrag_left_clamp:
            poly.material_index = slots["metal_edge"] if not sparse_cell(center, 6) else slots["cyber"]
        if telefrag_right_sinew:
            poly.material_index = slots["scar"] if not sparse_cell(center, 5) else slots["muscle_gloss"]
            if sparse_cell(center, 17):
                poly.material_index = slots["tendon"]
        if front and 1.315 < center.z < 1.535 and abs(center.x) < 0.160:
            protected_core = throat_socket or ellipsoid(center, (0.023, -0.064, 1.402), (0.052, 0.040, 0.076)) < 1.0
            if poly.material_index == slots["phase_skin"] and sparse_cell(center, 2):
                poly.material_index = slots["metal_edge"] if center.x < 0.015 else slots["scar"]
            if poly.material_index == slots["scar"] and center.z < 1.440 and sparse_cell(center, 4):
                poly.material_index = slots["clot"]
            if poly.material_index == slots["muscle_gloss"] and not wet_highlight_cell(center):
                poly.material_index = slots["muscle"]
            if not protected_core and center.x < -0.022 and poly.material_index in {
                slots["phase_skin"],
                slots["scar"],
                slots["muscle"],
                slots["muscle_gloss"],
                slots["clot"],
                slots["tendon"],
                slots["bone"],
            }:
                poly.material_index = slots["metal_edge"] if sparse_cell(center, 5) else slots["cyber"]
            if not protected_core and center.x > 0.050 and poly.material_index in {
                slots["phase_skin"],
                slots["cyber"],
                slots["metal_edge"],
                slots["copper"],
            }:
                poly.material_index = slots["muscle"] if sparse_cell(center, 4) else slots["scar"]


def assign_head_material_regions(head_obj: bpy.types.Object, mats: dict[str, bpy.types.Material]) -> None:
    slots = {
        "skin": material_slot(head_obj, mats["head_skin"]),
        "phase_skin": material_slot(head_obj, mats["phase_skin"]),
        "neck": material_slot(head_obj, mats["neck_skin"]),
        "scar": material_slot(head_obj, mats["scar_edge"]),
        "muscle": material_slot(head_obj, mats["muscle"]),
        "muscle_gloss": material_slot(head_obj, mats["muscle_gloss"]),
        "clot": material_slot(head_obj, mats["clot"]),
        "tendon": material_slot(head_obj, mats["tendon"]),
        "bone": material_slot(head_obj, mats["bone"]),
        "cyber": material_slot(head_obj, mats["cyber_metal"]),
        "metal_edge": material_slot(head_obj, mats["metal_edge"]),
        "copper": material_slot(head_obj, mats["copper"]),
        "green": material_slot(head_obj, mats["green_glow"]),
        "lash": material_slot(head_obj, mats["eyelash"]),
    }
    for poly in head_obj.data.polygons:
        current_mat = head_obj.data.materials[poly.material_index] if poly.material_index < len(head_obj.data.materials) else None
        if current_mat is not None and current_mat.name == mats["eyelash"].name:
            poly.material_index = slots["lash"]
            continue

        center = head_obj.matrix_world @ poly.center
        front = center.y < -0.020
        back = center.y > 0.035
        side = abs(center.x) > 0.072
        poly.material_index = slots["skin"]

        if center.z < 1.535:
            poly.material_index = slots["neck"]
            if neck_muscle_edge(center):
                poly.material_index = slots["scar"]
            if neck_muscle_band(center):
                poly.material_index = slots["muscle"]
                if sparse_cell(center, 3):
                    poly.material_index = slots["tendon"]
            if neck_cyber_band(center):
                poly.material_index = slots["cyber"]
            if abs(center.x) < 0.026 and center.y > -0.040:
                poly.material_index = slots["clot"]
            continue

        cyber_value = face_cyber_value(center)
        muscle_value = face_muscle_value(center)
        face_zone = center.z < 1.725 and center.y < 0.044
        cyber_outer = face_zone and (front or side) and ragged_value(cyber_value, center, 0.86, 1.16, 0.040, 37)
        cyber_edge = face_zone and (front or side) and ragged_value(cyber_value, center, 0.54, 0.86, 0.040, 7)
        cyber_core = face_zone and (front or side) and ragged_value(cyber_value, center, 0.0, 0.38, 0.035, 8)
        muscle_outer = front and ragged_value(muscle_value, center, 0.86, 1.20, 0.045, 38)
        muscle_edge = front and ragged_value(muscle_value, center, 0.54, 0.86, 0.040, 9)
        muscle_core = front and ragged_value(muscle_value, center, 0.0, 0.36, 0.035, 10)
        lower_mouth_tear = front and ragged_value(ellipsoid(center, (0.058, -0.062, 1.588), (0.058, 0.030, 0.032)), center, 0.0, 0.42, 0.035, 11)
        rear_occipital_rift = back and 1.590 < center.z < 1.775 and abs(center.x) < 0.055
        left_socket = front and ragged_value(ellipsoid(center, (-0.044, -0.064, 1.674), (0.043, 0.024, 0.030)), center, 0.0, 0.62, 0.030, 21)
        right_socket = front and ragged_value(ellipsoid(center, (0.047, -0.064, 1.666), (0.044, 0.024, 0.031)), center, 0.0, 0.58, 0.030, 22)
        left_socket_ring = front and ragged_value(ellipsoid(center, (-0.044, -0.064, 1.674), (0.057, 0.030, 0.041)), center, 0.56, 1.04, 0.035, 23)
        right_socket_ring = front and ragged_value(ellipsoid(center, (0.047, -0.064, 1.666), (0.058, 0.031, 0.041)), center, 0.56, 1.02, 0.035, 24)
        phase_echo = cranial_phase_echo(center)
        crown_suture = cranial_cyber_suture(center)
        scalp_mottle = cranial_necrotic_mottling(center)
        cranial_shell = front and cranial_cyber_shell(center)
        cranial_shell_feather = front and cranial_cyber_shell_feather(center)
        temple_tear = side and center.x < -0.040 and 1.622 < center.z < 1.742 and abs(center.y - 0.000) < 0.042

        if scalp_mottle:
            poly.material_index = slots["phase_skin"]
            if sparse_cell(center, 19):
                poly.material_index = slots["scar"]
        if phase_echo:
            poly.material_index = slots["phase_skin"]
            if sparse_cell(center, 11) and center.z < 1.735:
                poly.material_index = slots["scar"]
        if cranial_shell_feather:
            poly.material_index = slots["metal_edge"] if sparse_cell(center, 4) else slots["phase_skin"]
        if cranial_shell:
            poly.material_index = slots["cyber"] if center.z < 1.744 else slots["metal_edge"]
            if center.z > 1.706 and sparse_cell(center, 13):
                poly.material_index = slots["green"]
        if crown_suture:
            poly.material_index = slots["metal_edge"] if sparse_cell(center, 3) else slots["cyber"]
            if cranial_green_spark(center):
                poly.material_index = slots["green"]
        if cyber_outer:
            poly.material_index = slots["metal_edge"] if center.z > 1.610 else slots["phase_skin"]
            if sparse_cell(center, 10):
                poly.material_index = slots["scar"]
        if cyber_edge:
            poly.material_index = slots["metal_edge"] if center.z > 1.610 else slots["scar"]
            if sparse_cell(center, 15):
                poly.material_index = slots["clot"]
        if cyber_core:
            poly.material_index = slots["cyber"]
            if cyber_face_fissure(center):
                poly.material_index = slots["green"]
            elif copper_transition(center, (-0.056, -0.055, 1.654), (0.070, 0.050, 0.093)):
                poly.material_index = slots["copper"]

        if muscle_outer:
            poly.material_index = slots["phase_skin"] if not sparse_cell(center, 5) else slots["scar"]
        if muscle_edge:
            poly.material_index = slots["scar"]
            if sparse_cell(center, 9):
                poly.material_index = slots["tendon"]
            if cheek_blood_crack(center):
                poly.material_index = slots["clot"]
        if muscle_core or lower_mouth_tear:
            poly.material_index = slots["muscle"]
            if wet_highlight_cell(center):
                poly.material_index = slots["muscle_gloss"]
            if ellipsoid(center, (0.076, -0.067, 1.628), (0.031, 0.022, 0.029)) < 1.0:
                poly.material_index = slots["clot"]
            if front and center.z > 1.635 and center.x > 0.050:
                poly.material_index = slots["tendon"] if sparse_cell(center, 2) else slots["bone"]
            if cheek_blood_crack(center):
                poly.material_index = slots["clot"]

        if left_socket_ring:
            poly.material_index = slots["metal_edge"] if center.z > 1.667 else slots["cyber"]
            if sparse_cell(center, 11):
                poly.material_index = slots["copper"]
        if left_socket:
            poly.material_index = slots["cyber"]
            if cyber_eye_cut(center):
                poly.material_index = slots["green"]
            elif sparse_cell(center, 6):
                poly.material_index = slots["clot"]
        if right_socket_ring:
            poly.material_index = slots["scar"]
            if sparse_cell(center, 11):
                poly.material_index = slots["tendon"]
        if right_socket:
            poly.material_index = slots["muscle"] if center.z < 1.681 else slots["scar"]
            if wet_highlight_cell(center):
                poly.material_index = slots["muscle_gloss"]
            if human_eye_blood_pool(center):
                poly.material_index = slots["clot"]
        if temple_tear:
            poly.material_index = slots["cyber"] if sparse_cell(center, 2) else slots["metal_edge"]
            if cranial_green_spark(center):
                poly.material_index = slots["green"]
        if rear_occipital_rift:
            poly.material_index = slots["cyber"]
            if rear_head_fissure(center):
                poly.material_index = slots["green"]
            elif sparse_cell(center, 5):
                poly.material_index = slots["metal_edge"]


def is_dark_joint_region(center: Vector) -> bool:
    horizontal_breaks = [0.56, 0.86, 1.055, 1.245, 1.405]
    if any(abs(center.z - height) < 0.022 for height in horizontal_breaks):
        return True
    return abs(center.x) > 0.205 and 1.145 < center.z < 1.455 and abs(center.y) < 0.065


def ellipsoid(center: Vector, origin: tuple[float, float, float], radii: tuple[float, float, float]) -> float:
    dx = (center.x - origin[0]) / radii[0]
    dy = (center.y - origin[1]) / radii[1]
    dz = (center.z - origin[2]) / radii[2]
    return dx * dx + dy * dy + dz * dz


def diagonal_band_xz(center: Vector, start: tuple[float, float], end: tuple[float, float], width: float) -> bool:
    px = center.x
    pz = center.z
    sx, sz = start
    ex, ez = end
    vx = ex - sx
    vz = ez - sz
    length_sq = vx * vx + vz * vz
    if length_sq <= 0.000001:
        return math.hypot(px - sx, pz - sz) <= width
    t = max(0.0, min(1.0, ((px - sx) * vx + (pz - sz) * vz) / length_sq))
    closest_x = sx + vx * t
    closest_z = sz + vz * t
    return math.hypot(px - closest_x, pz - closest_z) <= width


def organic_breakup(center: Vector, seed: int) -> float:
    return (
        math.sin(center.x * (61.0 + seed) + center.z * 47.0 + center.y * 23.0)
        + 0.55 * math.sin(center.x * 113.0 - center.z * (31.0 + seed) + center.y * 59.0)
        + 0.35 * math.sin((center.x + center.y) * 173.0 + seed * 1.71)
    ) / 1.90


def ragged_value(value: float, center: Vector, low: float, high: float, amount: float, seed: int) -> bool:
    shifted_low = low + organic_breakup(center, seed) * amount
    shifted_high = high + organic_breakup(center, seed + 13) * amount
    if shifted_low > shifted_high:
        shifted_low, shifted_high = shifted_high, shifted_low
    return shifted_low <= value <= shifted_high


def face_cyber_value(center: Vector) -> float:
    cheek_socket = ellipsoid(center, (-0.060, -0.056, 1.650), (0.066, 0.049, 0.086))
    temple_plate = ellipsoid(center, (-0.092, -0.006, 1.670), (0.052, 0.062, 0.078))
    jaw_plate = ellipsoid(center, (-0.049, -0.056, 1.585), (0.056, 0.040, 0.051))
    return min(cheek_socket, temple_plate, jaw_plate)


def face_muscle_value(center: Vector) -> float:
    cheek_flay = ellipsoid(center, (0.064, -0.059, 1.610), (0.064, 0.041, 0.061))
    jaw_flay = ellipsoid(center, (0.056, -0.064, 1.572), (0.067, 0.034, 0.040))
    lip_tear = ellipsoid(center, (0.034, -0.067, 1.604), (0.054, 0.028, 0.026))
    return min(cheek_flay, jaw_flay, lip_tear)


def cranial_cyber_shell(center: Vector) -> bool:
    if center.z < 1.666 or center.z > 1.812 or center.y > 0.018 or center.x > 0.020:
        return False
    value = ellipsoid(center, (-0.040, -0.030, 1.732), (0.064, 0.044, 0.082))
    return ragged_value(value, center, 0.0, 0.64, 0.035, 28)


def cranial_cyber_shell_feather(center: Vector) -> bool:
    if center.z < 1.650 or center.z > 1.818 or center.y > 0.026 or center.x > 0.036:
        return False
    value = ellipsoid(center, (-0.040, -0.030, 1.732), (0.070, 0.049, 0.087))
    return ragged_value(value, center, 0.66, 1.10, 0.045, 39)


def cranial_phase_echo(center: Vector) -> bool:
    if center.z < 1.675 or center.z > 1.818 or center.y > 0.052:
        return False
    right_forehead = ragged_value(ellipsoid(center, (0.047, -0.043, 1.715), (0.050, 0.039, 0.050)), center, 0.0, 0.66, 0.07, 25)
    scalp_smear = ragged_value(ellipsoid(center, (0.026, 0.004, 1.766), (0.071, 0.056, 0.056)), center, 0.72, 1.06, 0.07, 26)
    side_afterimage = center.x > 0.078 and 1.690 < center.z < 1.775 and abs(center.y - 0.012) < 0.030
    return right_forehead or scalp_smear or (side_afterimage and sparse_cell(center, 3))


def cranial_necrotic_mottling(center: Vector) -> bool:
    if center.z < 1.700 or center.z > 1.815 or center.y > 0.068:
        return False
    crown = ellipsoid(center, (0.014, -0.010, 1.758), (0.102, 0.074, 0.060))
    rear = ellipsoid(center, (-0.010, 0.038, 1.720), (0.086, 0.050, 0.070))
    return (
        ragged_value(crown, center, 0.50, 1.10, 0.055, 55)
        or ragged_value(rear, center, 0.42, 0.92, 0.050, 56)
    ) and not cranial_cyber_shell(center)


def cranial_cyber_suture(center: Vector) -> bool:
    if center.z < 1.655 or center.z > 1.820:
        return False
    front_suture = center.y < 0.016 and diagonal_band_xz(center, (-0.020, 1.812), (-0.080, 1.642), 0.008)
    rear_suture = center.y > 0.022 and abs(center.x - 0.012 * math.sin((center.z - 1.640) * 40.0)) < 0.011
    temple_suture = center.x < -0.066 and 1.642 < center.z < 1.728 and abs(center.y + 0.010) < 0.020
    return front_suture or rear_suture or (temple_suture and sparse_cell(center, 2))


def cranial_green_spark(center: Vector) -> bool:
    if center.z < 1.635 or center.z > 1.815:
        return False
    return (
        abs(center.x + 0.047 + 0.21 * (center.z - 1.690)) < 0.007
        or abs(center.x - 0.012 * math.sin(center.z * 51.0)) < 0.008 and center.y > 0.020
    ) and sparse_cell(center, 5)


def cyber_eye_cut(center: Vector) -> bool:
    if not (center.y < -0.034 and -0.076 < center.x < -0.012 and 1.645 < center.z < 1.700):
        return False
    upper_cut = abs((center.x + 0.047) + 0.25 * (center.z - 1.674)) < 0.006
    lower_cut = abs((center.x + 0.038) - 0.35 * (center.z - 1.666)) < 0.005
    return (upper_cut or lower_cut) and sparse_cell(center, 2)


def human_eye_blood_pool(center: Vector) -> bool:
    if not (center.y < -0.034 and 0.018 < center.x < 0.086 and 1.642 < center.z < 1.690):
        return False
    lower_lid = center.z < 1.666 and abs((center.x - 0.050) - 0.18 * (center.z - 1.655)) < 0.017
    inner_corner = ellipsoid(center, (0.026, -0.066, 1.666), (0.017, 0.014, 0.018)) < 1.0
    return lower_lid or inner_corner


def rear_spine_wave(center: Vector) -> float:
    return 0.014 * math.sin((center.z - 0.96) * 24.0) + 0.006 * math.sin(center.z * 57.0)


def sparse_cell(center: Vector, cadence: int) -> bool:
    band = int((center.z - 0.35) * 59.0) + int((center.x + 0.40) * 23.0) - int((center.y + 0.25) * 13.0)
    return band % cadence == 0


def wet_highlight_cell(center: Vector) -> bool:
    sheen = (
        math.sin(center.x * 149.0 + center.z * 97.0)
        + 0.5 * math.sin(center.y * 211.0 - center.z * 53.0)
        + 0.35 * math.sin((center.x - center.y) * 277.0)
    )
    return sheen > 0.82


def copper_transition(center: Vector, origin: tuple[float, float, float], radii: tuple[float, float, float]) -> bool:
    value = ellipsoid(center, origin, radii)
    return 0.78 < value < 1.24 and sparse_cell(center, 5)


def cyber_face_fissure(center: Vector) -> bool:
    if not (center.y < -0.018 and -0.095 < center.x < -0.010 and 1.585 < center.z < 1.730):
        return False
    eye_spark = 1.638 < center.z < 1.707 and abs((center.x + 0.052) + 0.34 * (center.z - 1.660)) < 0.006
    jaw_spark = 1.575 < center.z < 1.628 and abs((center.x + 0.030) - 0.22 * (center.z - 1.610)) < 0.005
    return (eye_spark and sparse_cell(center, 2)) or (jaw_spark and sparse_cell(center, 3))


def cheek_blood_crack(center: Vector) -> bool:
    if not (center.y < -0.026 and 0.014 < center.x < 0.105 and 1.570 < center.z < 1.660):
        return False
    return abs((center.x - 0.054) - 0.30 * (center.z - 1.610)) < 0.010


def rear_head_fissure(center: Vector) -> bool:
    if not (center.y > 0.032 and 1.590 < center.z < 1.775):
        return False
    wavering_x = 0.014 * math.sin((center.z - 1.58) * 42.0)
    return abs(center.x - wavering_x) < 0.014 or abs(center.x + 0.034) < 0.009 and sparse_cell(center, 3)


def rear_fissure(center: Vector) -> bool:
    wavering_x = rear_spine_wave(center)
    interrupted_core = abs(center.x - wavering_x) < 0.007
    secondary_sparks = abs(center.x - wavering_x) < 0.014 and sparse_cell(center, 11)
    return interrupted_core or secondary_sparks


def sternum_fissure(center: Vector) -> bool:
    return (
        ellipsoid(center, (0.038, -0.060, 1.455), (0.074, 0.047, 0.055)) < 0.72
        and abs((center.x - 0.030) + 0.18 * (center.z - 1.440)) < 0.008
        and sparse_cell(center, 3)
    )


def telefrag_sternum_fissure(center: Vector) -> bool:
    if ellipsoid(center, (0.023, -0.064, 1.402), (0.076, 0.046, 0.104)) > 0.72:
        return False
    primary = abs((center.x - 0.022) + 0.11 * math.sin((center.z - 1.372) * 42.0)) < 0.014
    split = abs((center.x - 0.044) - 0.26 * (center.z - 1.402)) < 0.009
    return primary or (split and sparse_cell(center, 3))


def telefrag_sternum_bone(center: Vector) -> bool:
    if ellipsoid(center, (0.023, -0.064, 1.402), (0.080, 0.046, 0.106)) > 0.84:
        return False
    left_shard = abs((center.x - 0.010) + 0.31 * (center.z - 1.420)) < 0.008
    right_shard = abs((center.x - 0.052) - 0.24 * (center.z - 1.384)) < 0.007
    return (left_shard or right_shard) and sparse_cell(center, 4)


def neck_muscle_edge(center: Vector) -> bool:
    return center.y < 0.018 and ragged_value(ellipsoid(center, (0.035, -0.040, 1.500), (0.118, 0.062, 0.052)), center, 0.82, 1.28, 0.08, 14)


def neck_muscle_band(center: Vector) -> bool:
    return center.y < 0.015 and ragged_value(ellipsoid(center, (0.035, -0.040, 1.500), (0.106, 0.056, 0.046)), center, 0.0, 0.88, 0.06, 15)


def neck_cyber_band(center: Vector) -> bool:
    return center.x < -0.035 and center.y < 0.030 and 1.486 < center.z < 1.535


def sculpt_head_asymmetry(head_obj: bpy.types.Object) -> None:
    for vertex in head_obj.data.vertices:
        local = vertex.co
        if local.z < 1.535:
            if ellipsoid(local, (0.035, -0.040, 1.500), (0.115, 0.060, 0.050)) < 1.05:
                local.y += 0.0040
                local.x += 0.0010
            if local.x < -0.035 and local.y < 0.030:
                local.y -= 0.0020
            continue
        if ellipsoid(local, (-0.056, -0.055, 1.654), (0.078, 0.058, 0.104)) < 1.0:
            local.y -= 0.0035
            local.x -= 0.0015 + 0.0010 * math.sin(local.z * 75.0)
        if ellipsoid(local, (0.060, -0.058, 1.612), (0.082, 0.050, 0.078)) < 1.0:
            relief = 0.0030 * math.sin(local.z * 89.0 + local.x * 37.0)
            local.y += 0.0055 + relief
            local.x += 0.0017 * math.sin(local.z * 65.0)
        if ellipsoid(local, (-0.044, -0.064, 1.674), (0.054, 0.031, 0.040)) < 1.0:
            local.y -= 0.0055
            local.x -= 0.0022 + 0.0014 * math.sin(local.z * 91.0)
            local.z += 0.0014 * math.sin(local.x * 140.0)
        if ellipsoid(local, (0.047, -0.064, 1.666), (0.055, 0.032, 0.041)) < 1.0:
            lid_sag = max(0.0, min(1.0, (1.671 - local.z) / 0.045))
            local.y += 0.0038 + 0.0020 * lid_sag
            local.z -= 0.0016 * lid_sag
            local.x += 0.0015 * math.sin(local.z * 103.0)
        if cranial_phase_echo(local):
            local.y += 0.0015 * math.sin(local.x * 80.0 + local.z * 37.0)
            local.x += 0.0014 * math.sin(local.z * 64.0)
        if cranial_necrotic_mottling(local):
            local.y += 0.0011 * math.sin(local.x * 92.0 + local.z * 41.0)
            local.x += 0.0008 * math.sin(local.z * 59.0)
        if cranial_cyber_suture(local):
            local.y -= 0.0030
            local.x += 0.0016 * math.sin(local.z * 82.0)
        if cyber_face_fissure(local):
            local.y -= 0.0040
        if cheek_blood_crack(local):
            local.y += 0.0035
        if local.y > 0.030 and 1.590 < local.z < 1.775 and abs(local.x) < 0.058:
            local.y += 0.0025
            local.x += 0.0015 * math.sin(local.z * 44.0)
    head_obj.data.update()


def sculpt_body_glitch_offsets(carrier_mesh: bpy.types.Object) -> None:
    for vertex in carrier_mesh.data.vertices:
        local = vertex.co
        if local.z > 0.965 and abs(local.x) < 0.070 and local.y > 0.040:
            local.x += 0.0040 * math.sin(local.z * 25.0)
            local.y += 0.0045
        telefrag_value = ellipsoid(local, (0.023, -0.064, 1.402), (0.088, 0.060, 0.110))
        if local.y < -0.014 and telefrag_value < 1.02:
            recession = max(0.0, 1.0 - telefrag_value)
            local.y -= 0.0085 * recession
            local.x += 0.0025 * math.sin(local.z * 69.0 + local.x * 37.0) * recession
        if local.y < -0.014 and 0.72 < telefrag_value < 1.20:
            rim = 1.0 - min(abs(telefrag_value - 0.94) / 0.26, 1.0)
            local.y += 0.0042 * rim
        if local.y < -0.018 and ellipsoid(local, (0.038, -0.060, 1.455), (0.090, 0.060, 0.072)) < 1.05:
            local.y -= 0.0025
            local.x += 0.0015 * math.sin(local.z * 36.0)
        if local.y < -0.018 and diagonal_band_xz(local, (-0.004, 1.520), (0.018, 1.390), 0.040):
            local.y -= 0.0045
            local.x += 0.0020 * math.sin(local.z * 71.0)
        if local.y < -0.015 and 1.315 < local.z < 1.490 and 0.050 < abs(local.x) < 0.150:
            local.y -= 0.0025 * (1.0 + 0.35 * math.sin(local.z * 54.0 + local.x * 19.0))
        if local.y > 0.036 and 1.020 < local.z < 1.565 and abs(local.x - rear_spine_wave(local)) < 0.060:
            local.y += 0.0045
            local.x += 0.0020 * math.sin(local.z * 63.0)
        if local.y > 0.020 and 1.130 < local.z < 1.505 and 0.075 < abs(local.x) < 0.165:
            local.y += 0.0028
        if local.x < -0.130 and 0.780 < local.z < 1.455:
            local.x -= 0.0045 * math.sin(local.z * 42.0)
            local.y += 0.0025 * math.cos(local.z * 31.0)
        if local.x > 0.142 and 1.045 < local.z < 1.420:
            local.x += 0.0025 * math.sin(local.z * 39.0)
            local.y += 0.0018 * math.cos(local.z * 27.0)
    carrier_mesh.data.update()


def tone_accessories(accessory_objects: list[bpy.types.Object], mats: dict[str, bpy.types.Material]) -> None:
    for obj in accessory_objects:
        if obj.name == "experiment_reallusion_eyes":
            assign_eye_material_regions(obj, mats)
            sculpt_eye_life(obj)
        if obj.name == "experiment_reallusion_teeth":
            obj.data.materials.clear()
            obj.data.materials.append(mats["bone"])


def assign_eye_material_regions(eye_obj: bpy.types.Object, mats: dict[str, bpy.types.Material]) -> None:
    eye_obj.data.materials.clear()
    slots = {
        "eye": material_slot(eye_obj, mats["eye"]),
        "optic": material_slot(eye_obj, mats["optic_dark"]),
        "green": material_slot(eye_obj, mats["green_glow"]),
        "cyber": material_slot(eye_obj, mats["cyber_metal"]),
        "clot": material_slot(eye_obj, mats["clot"]),
    }
    centers = split_eye_centers(eye_obj)
    for poly in eye_obj.data.polygons:
        center = eye_obj.matrix_world @ poly.center
        side_key = "left" if center.x < 0.0 else "right"
        eye_center = centers[side_key]
        rel = center - eye_center
        iris_offset_x = -0.004 if side_key == "left" else 0.003
        iris_offset_z = -0.001 if side_key == "left" else -0.004
        radial = math.hypot(rel.x - iris_offset_x, rel.z - iris_offset_z)
        front_surface = rel.y < -0.0045
        poly.material_index = slots["eye"]
        if side_key == "left" and front_surface and radial < 0.034:
            poly.material_index = slots["green"]
        if side_key == "right" and front_surface and radial < 0.032:
            poly.material_index = slots["eye"]
            if rel.z < -0.002 and sparse_cell(center, 4):
                poly.material_index = slots["clot"]
        if front_surface and radial < 0.016:
            poly.material_index = slots["optic"]
        if side_key == "left" and front_surface and abs((rel.x - iris_offset_x) + 0.55 * (rel.z - iris_offset_z)) < 0.006 and radial < 0.041:
            poly.material_index = slots["green"]
        if side_key == "right" and front_surface and abs((rel.x - iris_offset_x) - 0.42 * (rel.z - iris_offset_z)) < 0.005 and radial < 0.038:
            poly.material_index = slots["optic"] if rel.z > 0.0 else slots["clot"]
        if not front_surface and side_key == "left" and sparse_cell(center, 7):
            poly.material_index = slots["cyber"]


def split_eye_centers(eye_obj: bpy.types.Object) -> dict[str, Vector]:
    buckets = {"left": [], "right": []}
    for vertex in eye_obj.data.vertices:
        world = eye_obj.matrix_world @ vertex.co
        buckets["left" if world.x < 0.0 else "right"].append(world)
    centers = {}
    for key, points in buckets.items():
        if not points:
            centers[key] = Vector((0.0, 0.0, 1.67))
            continue
        total = Vector((0.0, 0.0, 0.0))
        for point in points:
            total += point
        centers[key] = total / len(points)
    return centers


def sculpt_eye_life(eye_obj: bpy.types.Object) -> None:
    centers = split_eye_centers(eye_obj)
    for vertex in eye_obj.data.vertices:
        world = eye_obj.matrix_world @ vertex.co
        side_key = "left" if world.x < 0.0 else "right"
        eye_center = centers[side_key]
        rel = world - eye_center
        front_surface = rel.y < -0.0045
        radial = math.hypot(rel.x, rel.z)
        if not front_surface or radial > 0.046:
            continue
        if side_key == "left":
            vertex.co.y -= 0.0018 + 0.0008 * math.sin(rel.z * 160.0)
            vertex.co.x -= 0.0010 * math.sin(rel.z * 95.0)
        else:
            vertex.co.y -= 0.0008
            vertex.co.z -= 0.0014 * max(0.0, min(1.0, (0.024 - rel.z) / 0.048))
            vertex.co.x += 0.0009 * math.sin(rel.z * 120.0)
    eye_obj.data.update()


def create_body_telefrag_structures(mats: dict[str, bpy.types.Material]) -> list[bpy.types.Object]:
    vertices: list[tuple[float, float, float]] = []
    faces: list[tuple[int, ...]] = []
    face_materials: list[int] = []
    material_order = [
        mats["cyber_metal"],
        mats["metal_edge"],
        mats["copper"],
        mats["green_glow"],
        mats["tendon"],
        mats["bone"],
        mats["clot"],
        mats["muscle"],
        mats["muscle_gloss"],
    ]
    slots = {mat.name: index for index, mat in enumerate(material_order)}

    def slot(key: str) -> int:
        return slots[mats[key].name]

    for index, z in enumerate([0.990, 1.045, 1.102, 1.160, 1.220, 1.282, 1.344, 1.405, 1.466, 1.525]):
        center = Vector((rear_spine_wave(Vector((0.0, 0.080, z))), 0.091, z))
        width = 0.040 + (0.010 if index in {2, 6, 8} else 0.0)
        append_box_geometry(
            vertices,
            faces,
            face_materials,
            center,
            (width, 0.020, 0.031),
            slot("metal_edge" if index in {2, 6, 8} else "cyber_metal"),
        )
        if index not in {1, 5}:
            append_box_geometry(vertices, faces, face_materials, center + Vector((0.0, 0.014, 0.0)), (0.007, 0.006, 0.018), slot("green_glow"))
        side = -1.0 if index % 2 == 0 else 1.0
        append_bar_geometry(
            vertices,
            faces,
            face_materials,
            center + Vector((side * 0.014, 0.006, -0.012)),
            center + Vector((side * 0.074, 0.004, 0.012)),
            0.010,
            0.014,
            slot("copper" if index % 3 == 0 else "cyber_metal"),
        )

    append_bar_geometry(
        vertices,
        faces,
        face_materials,
        Vector((0.010, -0.083, 1.458)),
        Vector((0.026, -0.085, 1.340)),
        0.009,
        0.008,
        slot("clot"),
    )
    append_bar_geometry(
        vertices,
        faces,
        face_materials,
        Vector((0.001, -0.088, 1.446)),
        Vector((0.012, -0.089, 1.374)),
        0.005,
        0.006,
        slot("green_glow"),
    )
    append_front_ring_geometry(
        vertices,
        faces,
        face_materials,
        Vector((0.023, -0.087, 1.402)),
        (0.052, 0.082),
        (0.028, 0.046),
        lambda x, theta, index: slot("metal_edge")
        if x < 0.019
        else (slot("clot") if index % 3 else slot("tendon")),
        21,
        49,
    )
    append_front_disc_geometry(
        vertices,
        faces,
        face_materials,
        Vector((0.025, -0.089, 1.402)),
        (0.024, 0.044),
        slot("clot"),
        18,
        50,
    )
    append_bar_geometry(
        vertices,
        faces,
        face_materials,
        Vector((0.019, -0.094, 1.458)),
        Vector((0.028, -0.095, 1.346)),
        0.005,
        0.005,
        slot("green_glow"),
    )
    for index, z in enumerate([1.442, 1.405, 1.368]):
        append_bar_geometry(
            vertices,
            faces,
            face_materials,
            Vector((0.002, -0.091, z)),
            Vector((-0.086 - index * 0.004, -0.084, z + 0.020 - index * 0.008)),
            0.007,
            0.006,
            slot("cyber_metal" if index != 1 else "metal_edge"),
        )
        append_bar_geometry(
            vertices,
            faces,
            face_materials,
            Vector((0.036, -0.092, z - 0.010)),
            Vector((0.101 + index * 0.002, -0.084, z + 0.016 - index * 0.008)),
            0.006,
            0.006,
            slot("tendon" if index != 2 else "muscle_gloss"),
        )

    for index in range(3):
        z = 1.135 + index * 0.105
        append_bar_geometry(
            vertices,
            faces,
            face_materials,
            Vector((-0.168, -0.020, z)),
            Vector((-0.224, 0.030, z + 0.065)),
            0.012,
            0.016,
            slot("cyber_metal" if index != 1 else "copper"),
        )
        append_bar_geometry(
            vertices,
            faces,
            face_materials,
            Vector((0.162, -0.026, z + 0.030)),
            Vector((0.198, 0.028, z + 0.086)),
            0.009,
            0.012,
            slot("tendon"),
        )

    mesh = bpy.data.meshes.new("experiment_integrated_torso_spine_cage_mesh")
    mesh.from_pydata(vertices, [], faces)
    for mat in material_order:
        mesh.materials.append(mat)
    for poly, material_index in zip(mesh.polygons, face_materials):
        poly.material_index = material_index
    mesh.update()
    obj = bpy.data.objects.new("experiment_integrated_torso_spine_cage", mesh)
    bpy.context.collection.objects.link(obj)
    return [obj]


def ensure_generated_uv_projection(obj: bpy.types.Object) -> None:
    mesh = obj.data
    if mesh.uv_layers:
        return
    xs = [vertex.co.x for vertex in mesh.vertices]
    zs = [vertex.co.z for vertex in mesh.vertices]
    min_x, max_x = min(xs), max(xs)
    min_z, max_z = min(zs), max(zs)
    span_x = max(max_x - min_x, 0.001)
    span_z = max(max_z - min_z, 0.001)
    uv_layer = mesh.uv_layers.new(name="UVMap")
    for poly in mesh.polygons:
        for loop_index in poly.loop_indices:
            vertex = mesh.vertices[mesh.loops[loop_index].vertex_index]
            uv_layer.data[loop_index].uv = (
                ((vertex.co.x - min_x) / span_x) % 1.0,
                ((vertex.co.z - min_z) / span_z) % 1.0,
            )
    mesh.update()


def append_box_geometry(
    vertices: list[tuple[float, float, float]],
    faces: list[tuple[int, ...]],
    face_materials: list[int],
    center: Vector,
    size: tuple[float, float, float],
    material_index: int,
) -> None:
    base = len(vertices)
    half = Vector((size[0] * 0.5, size[1] * 0.5, size[2] * 0.5))
    outline = [
        (-0.52, -0.20),
        (-0.28, -0.50),
        (0.30, -0.44),
        (0.54, -0.14),
        (0.42, 0.35),
        (0.08, 0.52),
        (-0.42, 0.38),
        (-0.56, 0.05),
    ]
    for y_sign in (-1.0, 1.0):
        for x_factor, z_factor in outline:
            point = center + Vector((x_factor * half.x * 2.0, y_sign * half.y, z_factor * half.z * 2.0))
            vertices.append(tuple(point))
    count = len(outline)
    faces.append(tuple(base + index for index in reversed(range(count))))
    face_materials.append(material_index)
    faces.append(tuple(base + count + index for index in range(count)))
    face_materials.append(material_index)
    for index in range(count):
        next_index = (index + 1) % count
        faces.append((base + index, base + next_index, base + count + next_index, base + count + index))
        face_materials.append(material_index)


def append_front_ring_geometry(
    vertices: list[tuple[float, float, float]],
    faces: list[tuple[int, ...]],
    face_materials: list[int],
    center: Vector,
    outer_radius: tuple[float, float],
    inner_radius: tuple[float, float],
    material_selector,
    segments: int,
    seed: int,
) -> None:
    base = len(vertices)
    for ring_radius in (outer_radius, inner_radius):
        for index in range(segments):
            angle = (math.tau * index) / segments
            jitter = 1.0 + 0.075 * math.sin(index * 2.17 + seed * 0.73) + 0.035 * math.sin(index * 4.61 + seed)
            point = center + Vector((math.cos(angle) * ring_radius[0] * jitter, 0.0, math.sin(angle) * ring_radius[1] * jitter))
            vertices.append(tuple(point))
    for index in range(segments):
        next_index = (index + 1) % segments
        mid_angle = (math.tau * (index + 0.5)) / segments
        segment_x = center.x + math.cos(mid_angle) * outer_radius[0]
        faces.append((base + index, base + next_index, base + segments + next_index, base + segments + index))
        face_materials.append(material_selector(segment_x, mid_angle, index))


def append_front_disc_geometry(
    vertices: list[tuple[float, float, float]],
    faces: list[tuple[int, ...]],
    face_materials: list[int],
    center: Vector,
    radius: tuple[float, float],
    material_index: int,
    segments: int,
    seed: int,
) -> None:
    base = len(vertices)
    vertices.append(tuple(center))
    for index in range(segments):
        angle = (math.tau * index) / segments
        jitter = 1.0 + 0.090 * math.sin(index * 1.83 + seed * 0.41) + 0.045 * math.sin(index * 3.77 + seed)
        point = center + Vector((math.cos(angle) * radius[0] * jitter, 0.0, math.sin(angle) * radius[1] * jitter))
        vertices.append(tuple(point))
    for index in range(segments):
        next_index = 1 + ((index + 1) % segments)
        faces.append((base, base + 1 + index, base + next_index))
        face_materials.append(material_index)


def append_bar_geometry(
    vertices: list[tuple[float, float, float]],
    faces: list[tuple[int, ...]],
    face_materials: list[int],
    start: Vector,
    end: Vector,
    width: float,
    depth: float,
    material_index: int,
) -> None:
    axis = end - start
    side = Vector((-axis.z, 0.0, axis.x))
    if side.length < 0.000001:
        side = Vector((1.0, 0.0, 0.0))
    side.normalize()
    depth_axis = Vector((0.0, 1.0, 0.0))
    base = len(vertices)
    ring_count = 8
    taper = 0.74 + 0.16 * abs(math.sin((start.z + end.z) * 19.0 + start.x * 11.0))
    for point, scale in [(start, taper), (end, 1.0)]:
        for index in range(ring_count):
            angle = (math.tau * index) / ring_count
            irregularity = 1.0 + 0.08 * math.sin(index * 2.31 + start.z * 17.0 + end.x * 23.0)
            offset = (
                side * (math.cos(angle) * width * 0.5 * scale * irregularity)
                + depth_axis * (math.sin(angle) * depth * 0.5 * scale)
            )
            vertices.append(tuple(point + offset))
    faces.append(tuple(base + index for index in reversed(range(ring_count))))
    face_materials.append(material_index)
    faces.append(tuple(base + ring_count + index for index in range(ring_count)))
    face_materials.append(material_index)
    for index in range(ring_count):
        next_index = (index + 1) % ring_count
        faces.append((base + index, base + next_index, base + ring_count + next_index, base + ring_count + index))
        face_materials.append(material_index)


def polish_transplant_objects(objects: list[bpy.types.Object]) -> None:
    for obj in objects:
        if obj.type != "MESH":
            continue
        for poly in obj.data.polygons:
            poly.use_smooth = True
        if obj.name == "experiment_integrated_torso_spine_cage":
            bevel = obj.modifiers.new(name="EX_cage_micro_bevel", type="BEVEL")
            bevel.width = 0.0028
            bevel.segments = 2
            bevel.profile = 0.42
            continue
        weighted = obj.modifiers.new(name="EX_weighted_normals", type="WEIGHTED_NORMAL")
        weighted.keep_sharp = True


def render_preview_set(dist_dir: Path) -> list[str]:
    setup_preview_scene()
    scene = bpy.context.scene
    camera = scene.camera
    center, extent = scene_bounds()
    target = center + Vector((0, 0, extent.z * 0.03))
    distance = max(extent.x, extent.y, extent.z, 1.0) * 2.50
    camera.data.ortho_scale = max(extent.z * 1.20, extent.x * 1.85, 2.25)
    views = [
        ("front", Vector((center.x, center.y - distance, center.z))),
        ("side", Vector((center.x + distance, center.y, center.z))),
        ("back", Vector((center.x, center.y + distance, center.z))),
        ("iso", Vector((center.x + distance * 0.75, center.y - distance, center.z + extent.z * 0.52))),
        ("head_closeup", Vector((center.x, center.y - distance * 0.82, center.z + extent.z * 0.36))),
        ("torso_closeup", Vector((center.x + distance * 0.20, center.y - distance * 0.88, center.z + extent.z * 0.18))),
    ]
    paths: list[str] = []
    for label, location in views:
        camera.location = location
        if label == "head_closeup":
            look_at(camera, Vector((center.x, center.y, 1.635)))
            camera.data.ortho_scale = 0.44
        elif label == "torso_closeup":
            look_at(camera, Vector((center.x, center.y - 0.005, 1.385)))
            camera.data.ortho_scale = 0.66
        else:
            look_at(camera, target)
            camera.data.ortho_scale = max(extent.z * 1.20, extent.x * 1.85, 2.25)
        output_path = dist_dir / f"{VARIANT_ID}_{label}.png"
        scene.render.filepath = str(output_path)
        bpy.ops.render.render(write_still=True)
        paths.append(str(output_path))
    paths.extend(render_head_diagnostic_set(dist_dir, camera))
    mask_preview = dist_dir / f"{MASK_ATLAS_NAME}_preview.png"
    if mask_preview.exists():
        paths.append(str(mask_preview))
    make_contact_sheet(paths, dist_dir / f"{VARIANT_ID}_contact_sheet.png")
    return [path_relative_to_project(path) for path in paths]


def render_head_diagnostic_set(dist_dir: Path, camera: bpy.types.Object) -> list[str]:
    head_obj = bpy.data.objects.get("experiment_reallusion_integrated_head")
    if head_obj is None:
        return []
    paths = [
        render_head_wireframe_diagnostic(dist_dir, camera, head_obj),
        render_head_vertex_mask_diagnostic(dist_dir, camera, head_obj),
    ]
    return [str(path) for path in paths if path is not None]


def render_head_wireframe_diagnostic(
    dist_dir: Path,
    camera: bpy.types.Object,
    head_obj: bpy.types.Object,
) -> Path:
    output_path = dist_dir / f"{VARIANT_ID}_head_wireframe.png"
    shell_mat = make_diag_material("EX_preview_head_wire_shell_mat", (0.038, 0.048, 0.050, 1.0), strength=0.65)
    wire_mat = make_diag_material("EX_preview_head_wire_line_mat", (0.130, 0.900, 0.640, 1.0), strength=1.55)
    shell_obj = duplicate_mesh_for_diagnostic(head_obj, "EX_preview_head_wire_shell", shell_mat)
    wire_obj = duplicate_mesh_for_diagnostic(head_obj, "EX_preview_head_wire_topology", wire_mat)
    wire = wire_obj.modifiers.new(name="EX_preview_wireframe_edges", type="WIREFRAME")
    wire.thickness = 0.00135
    wire.use_even_offset = True
    wire.use_replace = True
    try:
        render_head_diagnostic_camera(camera, head_obj)
        render_with_visible_meshes({shell_obj, wire_obj}, output_path)
    finally:
        remove_diagnostic_objects([shell_obj, wire_obj])
        remove_diagnostic_materials([shell_mat, wire_mat])
    return output_path


def render_head_vertex_mask_diagnostic(
    dist_dir: Path,
    camera: bpy.types.Object,
    head_obj: bpy.types.Object,
) -> Path:
    output_path = dist_dir / f"{VARIANT_ID}_head_vertex_mask.png"
    mask_mat = make_vertex_mask_debug_material()
    mask_obj = duplicate_mesh_for_diagnostic(head_obj, "EX_preview_head_vertex_mask", mask_mat)
    try:
        render_head_diagnostic_camera(camera, head_obj)
        render_with_visible_meshes({mask_obj}, output_path)
    finally:
        remove_diagnostic_objects([mask_obj])
        remove_diagnostic_materials([mask_mat])
    return output_path


def render_head_diagnostic_camera(camera: bpy.types.Object, head_obj: bpy.types.Object) -> None:
    bounds = object_bounds(head_obj)
    center = Vector(bounds["center"])
    extent = Vector(bounds["size"])
    distance = max(extent.x, extent.y, extent.z, 0.35) * 5.4
    camera.location = Vector((center.x, center.y - distance, center.z + extent.z * 0.020))
    look_at(camera, center + Vector((0.0, 0.0, extent.z * 0.015)))
    camera.data.ortho_scale = max(extent.z * 1.16, extent.x * 1.72, 0.40)


def render_with_visible_meshes(visible_meshes: set[bpy.types.Object], output_path: Path) -> None:
    mesh_state = {
        obj: (obj.hide_get(), obj.hide_render)
        for obj in bpy.context.scene.objects
        if obj.type == "MESH"
    }
    try:
        for obj in mesh_state:
            visible = obj in visible_meshes
            obj.hide_set(not visible)
            obj.hide_render = not visible
        bpy.context.scene.render.filepath = str(output_path)
        bpy.ops.render.render(write_still=True)
    finally:
        for obj, (hide_viewport, hide_render) in mesh_state.items():
            if obj.name in bpy.data.objects:
                obj.hide_set(hide_viewport)
                obj.hide_render = hide_render


def duplicate_mesh_for_diagnostic(
    source: bpy.types.Object,
    name: str,
    material: bpy.types.Material,
) -> bpy.types.Object:
    obj = duplicate_mesh_object_for_diagnostic(source, name)
    replace_materials_for_diagnostic(obj, [material])
    return obj


def duplicate_mesh_object_for_diagnostic(source: bpy.types.Object, name: str) -> bpy.types.Object:
    mesh = source.data.copy()
    mesh.name = f"{name}_mesh"
    obj = bpy.data.objects.new(name, mesh)
    obj.matrix_world = source.matrix_world.copy()
    bpy.context.collection.objects.link(obj)
    return obj


def make_vertex_mask_debug_material() -> bpy.types.Material:
    mat = bpy.data.materials.new("EX_preview_head_vertex_mask_debug")
    mat.use_nodes = True
    mat.diffuse_color = (0.18, 0.72, 0.58, 1.0)
    nodes = mat.node_tree.nodes
    nodes.clear()
    output = nodes.new(type="ShaderNodeOutputMaterial")
    attribute = nodes.new(type="ShaderNodeAttribute")
    attribute.attribute_name = "rl_head_region_mask"
    emission = nodes.new(type="ShaderNodeEmission")
    emission.inputs["Strength"].default_value = 1.85
    mat.node_tree.links.new(attribute.outputs["Color"], emission.inputs["Color"])
    mat.node_tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return mat


def make_diag_material(name: str, color, strength: float = 1.0) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    output = nodes.new(type="ShaderNodeOutputMaterial")
    emission = nodes.new(type="ShaderNodeEmission")
    emission.inputs["Color"].default_value = color
    emission.inputs["Strength"].default_value = strength
    mat.node_tree.links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return mat


def replace_materials_for_diagnostic(obj: bpy.types.Object, materials: list[bpy.types.Material]) -> None:
    obj.data.materials.clear()
    for mat in materials:
        obj.data.materials.append(mat)
    for poly in obj.data.polygons:
        poly.material_index = min(poly.material_index, len(materials) - 1)


def remove_diagnostic_objects(objects: list[bpy.types.Object]) -> None:
    for obj in objects:
        mesh = obj.data if obj.type == "MESH" else None
        bpy.data.objects.remove(obj, do_unlink=True)
        if mesh is not None and mesh.users == 0:
            bpy.data.meshes.remove(mesh)


def remove_diagnostic_materials(materials: list[bpy.types.Material]) -> None:
    for mat in materials:
        if mat.users == 0:
            bpy.data.materials.remove(mat)


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
    scene.world = scene.world or bpy.data.worlds.new("EX_transplant_preview_world")
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
    key.data.energy = 680
    key.data.size = 4.4

    bpy.ops.object.light_add(type="AREA", location=(center.x + 2.3, center.y - 1.8, center.z + 1.8))
    fill = bpy.context.object
    fill.name = "EX_preview_fill_light"
    fill.data.color = (0.74, 0.82, 0.94)
    fill.data.energy = 150
    fill.data.size = 5.0

    bpy.ops.object.light_add(type="POINT", location=(center.x - 0.6, center.y - 1.0, 1.72))
    face = bpy.context.object
    face.name = "EX_preview_face_catch_light"
    face.data.color = (0.78, 0.90, 0.92)
    face.data.energy = 60

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
    columns = 4 if len(paths) == 8 else 3 if len(paths) <= 9 else math.ceil(math.sqrt(len(paths)))
    rows = math.ceil(len(paths) / columns)
    subprocess.run(
        [
            montage,
            *paths,
            "-tile",
            f"{columns}x{rows}",
            "-geometry",
            "+10+10",
            "-background",
            "#111111",
            str(output_path),
        ],
        check=True,
    )


def write_report(
    project_root: Path,
    base_glb: Path,
    reallusion_fbx: Path,
    blend_path: Path,
    dist_glb: Path,
    art_glb: Path,
    previews: list[str],
    removed_faces: int,
    transplant_group: list[bpy.types.Object],
    body_structures: list[bpy.types.Object],
    transform_report: dict,
    mask_metadata: dict,
) -> None:
    report_path = dist_glb.parent / f"{VARIANT_ID}_report.json"
    glb_stats = read_glb_stats(dist_glb)
    validation = validate_experiment_asset(glb_stats, removed_faces, transplant_group, mask_metadata)
    report_mask_metadata = {
        key: value
        for key, value in mask_metadata.items()
        if key != "absolute_path"
    }
    diagnostic_previews = [
        preview
        for preview in previews
        if any(token in Path(preview).name for token in ["wireframe", "vertex_mask", "skin_masks"])
    ]
    report = {
        "variant_id": VARIANT_ID,
        "status": "reallusion_head_transplant_compiled",
        "source_model": path_relative_to_project(base_glb),
        "replacement_head_source": path_relative_to_project(reallusion_fbx),
        "replacement_head_source_id": REALLUSION_SOURCE_ID,
        "implementation_approach": "The Mesh2Motion body and animations are preserved. The original mannequin head is cut away above the neck, an official Reallusion CC3 neutral head/neck region is extracted from CC_Base_Body, and the CC head plus eyes/teeth/tongue are bound to the existing Mesh2Motion head/neck bones.",
        "blender": {
            "compiler": "scripts/build-experiment-reallusion-head-blender.py",
            "available_in_this_vm": True,
            "version": bpy.app.version_string,
            "executed": True,
        },
        "artifacts": {
            "blend": path_relative_to_project(blend_path),
            "glb_dist": path_relative_to_project(dist_glb),
            "glb_godot": path_relative_to_project(art_glb),
            "previews": previews,
            "diagnostic_previews": diagnostic_previews,
            "contact_sheet": path_relative_to_project(dist_glb.parent / f"{VARIANT_ID}_contact_sheet.png"),
        },
        "texture_masks": {
            "skin_mask_atlas": report_mask_metadata,
        },
        "geometry": {
            "carrier_head_faces_removed": removed_faces,
            "transplant_objects": [
                {
                    "name": obj.name,
                    "vertices": len(obj.data.vertices),
                    "polygons": len(obj.data.polygons),
                    "materials": [mat.name if mat else "" for mat in obj.data.materials],
                    "shape_keys": len(obj.data.shape_keys.key_blocks) if obj.data.shape_keys else 0,
                }
                for obj in transplant_group
            ],
            "integrated_body_structures": [
                {
                    "name": obj.name,
                    "vertices": len(obj.data.vertices),
                    "polygons": len(obj.data.polygons),
                    "materials": [mat.name if mat else "" for mat in obj.data.materials],
                }
                for obj in body_structures
            ],
            "total_mesh_count": glb_stats["mesh_count"],
            "material_count": glb_stats["material_count"],
            "animation_count": glb_stats["animation_count"],
            "external_textures": False,
            "dist_glb_bytes": dist_glb.stat().st_size if dist_glb.exists() else 0,
        },
        "fit": transform_report,
        "validation_questions": {
            "mesh2motion_animation_preserved": glb_stats["animation_count"] > 0,
            "old_mannequin_head_removed": removed_faces > 0,
            "reallusion_head_topology_present": any(obj.name == "experiment_reallusion_integrated_head" for obj in transplant_group),
            "eyes_teeth_tongue_present": all(
                any(obj.name == expected for obj in transplant_group)
                for expected in ["experiment_reallusion_eyes", "experiment_reallusion_teeth", "experiment_reallusion_tongue"]
            ),
            "facial_shape_keys_present": any((obj.data.shape_keys and len(obj.data.shape_keys.key_blocks) > 1) for obj in transplant_group),
            "head_region_vertex_color_mask_present": bpy.data.objects["experiment_reallusion_integrated_head"].data.color_attributes.get("rl_head_region_mask") is not None,
        },
        "validation": validation,
        "notes": [
            "This older direct Reallusion CC3 template did not import with facial shape keys; the account-gated newer free base package may be needed for blink/jaw morph tests.",
            "Integrated gore/cyborg regions are authored through mesh edits, material zones, and vertex color masks; detached face props remain forbidden.",
            "No Reallusion textures are embedded in the runtime GLB; the only runtime texture is the custom packed experiment skin mask atlas.",
        ],
    }
    report_path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")


def validate_experiment_asset(
    glb_stats: dict[str, int],
    removed_faces: int,
    transplant_group: list[bpy.types.Object],
    mask_metadata: dict,
) -> dict:
    forbidden_tokens = ("face_prop", "eye_prop", "jaw_prop", "mouth_prop", "sticker", "decal")
    forbidden_names = [
        obj.name
        for obj in bpy.context.scene.objects
        if any(token in obj.name.lower() for token in forbidden_tokens)
    ]
    allowed_face_objects = {
        "experiment_reallusion_integrated_head",
        "experiment_reallusion_eyes",
        "experiment_reallusion_teeth",
        "experiment_reallusion_tongue",
    }
    face_intruders = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj.name.startswith("EX_preview_") or obj.name in allowed_face_objects:
            continue
        bounds = object_bounds(obj)
        bounds_min = Vector(bounds["min"])
        bounds_max = Vector(bounds["max"])
        intersects_face = (
            bounds_max.z > 1.535
            and bounds_min.z < 1.820
            and bounds_max.y > -0.105
            and bounds_min.y < 0.105
            and bounds_max.x > -0.170
            and bounds_min.x < 0.170
        )
        if intersects_face:
            face_intruders.append(obj.name)
    head_obj = bpy.data.objects.get("experiment_reallusion_integrated_head")
    mask_path = mask_metadata.get("absolute_path")
    mask_stats = mask_metadata.get("channel_stats") or {}
    mask_channels_nonblank = bool(
        mask_path
        and Path(mask_path).exists()
        and mask_metadata.get("dimensions") == [MASK_ATLAS_SIZE, MASK_ATLAS_SIZE]
        and all((mask_stats.get(channel) or {}).get("nonblank") for channel in MASK_CHANNEL_CONVENTION)
    )
    checks = {
        "no_forbidden_prop_names": not forbidden_names,
        "no_detached_face_region_intruders": not face_intruders,
        "mesh_count_within_agent_budget": glb_stats["mesh_count"] <= 6,
        "material_count_within_agent_budget": glb_stats["material_count"] <= 18,
        "animations_preserved": glb_stats["animation_count"] >= 80,
        "carrier_head_cut_performed": removed_faces > 0,
        "head_vertex_color_mask_present": bool(
            head_obj is not None and head_obj.data.color_attributes.get("rl_head_region_mask") is not None
        ),
        "eyes_teeth_tongue_present": all(
            any(obj.name == expected for obj in transplant_group)
            for expected in ["experiment_reallusion_eyes", "experiment_reallusion_teeth", "experiment_reallusion_tongue"]
        ),
        "mask_atlas_channels_nonblank": mask_channels_nonblank,
    }
    return {
        "passed": all(checks.values()),
        "checks": checks,
        "forbidden_names": forbidden_names,
        "face_region_intruders": face_intruders,
    }


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
