#!/usr/bin/env python3
"""Build the experiment slot with a Reallusion CC head transplanted onto Mesh2Motion."""

from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
from collections import Counter, defaultdict
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
TORSO_DETAIL_MAP_SIZE = 512
TORSO_DETAIL_MAP_NAME = f"{VARIANT_ID}_torso_micro_normal_{TORSO_DETAIL_MAP_SIZE}"
MASK_UV_NAME = "EX_mask_projection_uv"
BODY_TORSO_MASK_NAME = "EX_body_torso_mask"
MASK_CHANNEL_CONVENTION = {
    "R": "skin_to_muscle_blend",
    "G": "wetness",
    "B": "exposed_bone",
    "A": "blood_clot_glitch_breakup",
}
MAX_EXPERIMENT_MATERIALS = 26


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
    torso_detail_metadata = build_torso_micro_detail_map(dist_dir)
    mask_image = bpy.data.images.load(str(mask_metadata["absolute_path"]), check_existing=True)
    mask_image.name = MASK_ATLAS_NAME
    mask_image.colorspace_settings.name = "Non-Color"
    torso_detail_image = bpy.data.images.load(str(torso_detail_metadata["absolute_path"]), check_existing=True)
    torso_detail_image.name = TORSO_DETAIL_MAP_NAME
    torso_detail_image.colorspace_settings.name = "Non-Color"

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    bpy.ops.import_scene.gltf(filepath=str(base_glb))
    carrier_armature = first_object_of_type("ARMATURE")
    carrier_mesh = first_object_of_type("MESH")
    if carrier_armature is None or carrier_mesh is None:
        raise RuntimeError("Imported Mesh2Motion GLB did not contain the expected armature and mesh")

    mats = make_materials()
    mask_material_uses = apply_mask_atlas_to_materials(mats, mask_image, torso_detail_image)
    apply_body_torso_attribute_grades(mats)
    apply_machine_surface_breakup(mats)
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
    for obj in [head_obj, *accessory_objects, *body_structures]:
        apply_body_torso_vertex_mask(obj)
    apply_mask_projection_uvs([carrier_mesh, head_obj, *body_structures])
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
        torso_detail_metadata,
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

        striation_gate = smoothstep(0.38, 0.88, diagonal) * (0.55 + vein_trace * 0.45)
        r = clamp01(0.16 + torn_edge * 0.48 + vein_trace * 0.16 + striation_gate * 0.10)
        g = clamp01(0.06 + vein_trace * 0.58 + clot_trace * 0.18 + cellular_break * 0.20)
        b = clamp01(0.03 + max(torn_edge - cellular_break * 0.42, 0.0) * 0.78 + radial_falloff * 0.10)
        a = clamp01(0.10 + clot_trace * 0.68 + cellular_break * 0.30 + (1.0 - radial_falloff) * 0.06)

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
        "usage": "Projected over the head/body to soften material islands, darken wound breakup, and modulate wetness/roughness on skin, tissue, metal, and glitch materials.",
    }


def build_torso_micro_detail_map(dist_dir: Path) -> dict:
    size = TORSO_DETAIL_MAP_SIZE
    heights: list[float] = []
    for index in range(size * size):
        x = index % size
        y = index // size
        u = x / max(1, size - 1)
        v = y / max(1, size - 1)
        heights.append(torso_micro_detail_height_uv(u, v))

    normal_pixels: list[float] = []
    preview_pixels: list[float] = []
    for index, height in enumerate(heights):
        x = index % size
        y = index // size
        left = heights[y * size + max(0, x - 1)]
        right = heights[y * size + min(size - 1, x + 1)]
        down = heights[max(0, y - 1) * size + x]
        up = heights[min(size - 1, y + 1) * size + x]
        dx = right - left
        dy = up - down
        normal = Vector((-dx * 4.6, -dy * 4.6, 1.0))
        normal.normalize()
        normal_pixels.extend(
            (
                clamp01(normal.x * 0.5 + 0.5),
                clamp01(normal.y * 0.5 + 0.5),
                clamp01(normal.z * 0.5 + 0.5),
                1.0,
            )
        )
        warm_height = clamp01(0.18 + height * 0.82)
        preview_pixels.extend((warm_height, warm_height * 0.56, warm_height * 0.38, 1.0))

    normal_path = dist_dir / f"{TORSO_DETAIL_MAP_NAME}.png"
    preview_path = dist_dir / f"{TORSO_DETAIL_MAP_NAME}_preview.png"
    save_float_rgba_png(TORSO_DETAIL_MAP_NAME, size, size, normal_pixels, normal_path)
    save_float_rgba_png(f"{TORSO_DETAIL_MAP_NAME}_preview", size, size, preview_pixels, preview_path)
    return {
        "absolute_path": normal_path,
        "path": path_relative_to_project(normal_path),
        "preview": path_relative_to_project(preview_path),
        "dimensions": [size, size],
        "format": "RGBA PNG tangent normal",
        "usage": "Chest-local micro striation normal detail for the unified telefrag wound material.",
        "height_stats": channel_stat(heights),
    }


def torso_micro_detail_height_uv(u: float, v: float) -> float:
    radial = math.hypot((u - 0.52) / 0.68, (v - 0.55) / 0.86)
    wound_falloff = 1.0 - smoothstep(0.20, 0.88, radial)
    diagonal_a = 0.5 + 0.5 * math.sin((u * 10.7 - v * 15.8 + 0.22 * math.sin(v * math.tau * 3.0)) * math.tau)
    diagonal_b = 0.5 + 0.5 * math.sin((u * 17.0 + v * 8.5) * math.tau + 0.7)
    tendon_threads = 0.5 + 0.5 * math.sin((u * 34.0 + v * 2.6 + 0.18 * math.sin(u * math.tau * 5.0)) * math.tau)
    vein = smoothstep(0.72, 0.98, diagonal_a) * 0.70 + smoothstep(0.80, 1.0, diagonal_b) * 0.30
    groove_wave = 0.5 + 0.5 * math.sin((u * 26.0 - v * 4.0) * math.tau)
    wet_pits = smoothstep(0.82, 1.0, groove_wave)
    cellular = (
        math.sin(u * 93.0 + v * 61.0)
        + 0.55 * math.sin(u * 181.0 - v * 127.0)
        + 0.35 * math.sin((u + v) * 271.0)
    ) / 1.90
    clot_breakup = smoothstep(0.40, 0.96, 0.5 + cellular * 0.5)
    height = 0.48 + wound_falloff * (0.28 * vein + 0.11 * smoothstep(0.72, 1.0, tendon_threads) - 0.24 * wet_pits + 0.13 * clot_breakup)
    return clamp01(height)


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
        "carrier": make_mat("EX_body_burnished_gunmetal", (0.118, 0.126, 0.122, 1.0), 0.78, 0.36),
        "carrier_shadow": make_mat("EX_body_deep_joint_shadow", (0.018, 0.022, 0.024, 1.0), 0.58, 0.48),
        "head_skin": make_mat("EX_head_pallid_necrotic_skin", (0.275, 0.252, 0.220, 1.0), 0.0, 0.68),
        "phase_skin": make_mat("EX_transient_human_phase_skin", (0.130, 0.100, 0.080, 1.0), 0.0, 0.70),
        "neck_skin": make_mat("EX_neck_torn_skin_edge", (0.052, 0.018, 0.016, 1.0), 0.0, 0.42),
        "scar_edge": make_mat("EX_livid_torn_transition_skin", (0.030, 0.004, 0.004, 1.0), 0.0, 0.44),
        "muscle": make_mat("EX_subdermal_wet_muscle", (0.044, 0.004, 0.004, 1.0), 0.0, 0.18),
        "muscle_gloss": make_mat("EX_subdermal_wet_muscle_gloss", (0.078, 0.012, 0.010, 1.0), 0.0, 0.12),
        "clot": make_mat("EX_clotted_black_blood", (0.032, 0.002, 0.002, 1.0), 0.0, 0.16),
        "tendon": make_mat("EX_frayed_tendon_strand", (0.116, 0.082, 0.058, 1.0), 0.0, 0.34),
        "bone": make_mat("EX_sick_exposed_bone", (0.128, 0.110, 0.078, 1.0), 0.0, 0.70),
        "torso_blend": make_mat("EX_torso_masked_telefrag_wound", (0.055, 0.074, 0.070, 1.0), 0.45, 0.26),
        "cyber_metal": make_mat("EX_necron_oxidized_cybermetal", (0.082, 0.092, 0.088, 1.0), 0.88, 0.27),
        "metal_edge": make_mat("EX_burnished_cut_metal_edge", (0.225, 0.230, 0.210, 1.0), 0.90, 0.30),
        "copper": make_mat("EX_copper_patina_corrosion", (0.168, 0.085, 0.047, 1.0), 0.82, 0.34),
        "green_glow": make_mat("EX_sparse_molten_green_fissure", (0.001, 0.018, 0.014, 1.0), 0.0, 0.30, (0.006, 0.115, 0.064), 0.08),
        "eyelash": make_mat("EX_reallusion_eyelash_dark", (0.015, 0.012, 0.010, 1.0), 0.0, 0.68),
        "eye": make_mat("EX_milky_dead_machine_eye", (0.640, 0.612, 0.530, 1.0), 0.0, 0.18, (0.030, 0.026, 0.018), 0.025),
        "optic_dark": make_mat("EX_recessed_black_optic_core", (0.004, 0.005, 0.005, 1.0), 0.0, 0.08, (0.006, 0.008, 0.007), 0.025),
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
    torso_detail_image: bpy.types.Image,
) -> list[str]:
    material_keys = [
        "head_skin",
        "phase_skin",
        "neck_skin",
        "scar_edge",
        "muscle",
        "muscle_gloss",
        "clot",
        "tendon",
        "bone",
        "torso_blend",
        "cyber_metal",
        "metal_edge",
        "copper",
        "green_glow",
    ]
    embedded_materials: list[str] = []
    for key in material_keys:
        mat = mats.get(key)
        if mat is None:
            continue
        if key == "torso_blend":
            apply_torso_blend_material(mat, mask_image, torso_detail_image)
        else:
            apply_mask_atlas_to_material(mat, mask_image, key)
        embedded_materials.append(mat.name)
    return embedded_materials


def apply_body_torso_attribute_grades(mats: dict[str, bpy.types.Material]) -> None:
    for key in [
        "carrier",
        "carrier_shadow",
        "phase_skin",
        "neck_skin",
        "scar_edge",
        "muscle",
        "muscle_gloss",
        "clot",
        "tendon",
        "bone",
        "cyber_metal",
        "metal_edge",
        "copper",
    ]:
        mat = mats.get(key)
        if mat is not None:
            apply_body_torso_attribute_grade(mat, key)


def apply_body_torso_attribute_grade(mat: bpy.types.Material, material_key: str) -> None:
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    if bsdf is None:
        return
    base_color = bsdf.inputs.get("Base Color")
    if base_color is None:
        return

    channel_name, target, factor_min, factor_max, blend_type = body_torso_attribute_settings(material_key)
    attribute = nodes.new(type="ShaderNodeAttribute")
    attribute.name = f"EX_{material_key}_body_torso_mask_attr"
    attribute.attribute_name = BODY_TORSO_MASK_NAME
    separate = nodes.new(type="ShaderNodeSeparateRGB")
    separate.name = f"EX_{material_key}_body_torso_mask_channels"
    links.new(attribute.outputs["Color"], separate.inputs["Image"])

    factor = nodes.new(type="ShaderNodeMapRange")
    factor.name = f"EX_{material_key}_body_torso_grade_factor"
    factor.inputs["From Min"].default_value = 0.0
    factor.inputs["From Max"].default_value = 1.0
    factor.inputs["To Min"].default_value = factor_min
    factor.inputs["To Max"].default_value = factor_max

    source = attribute.outputs["Alpha"] if channel_name == "A" else separate.outputs[channel_name]
    links.new(source, factor.inputs["Value"])
    overlay_color_mix(nodes, links, base_color, mat.diffuse_color, factor.outputs["Result"], target, blend_type, f"EX_{material_key}_body_torso_grade")


def apply_machine_surface_breakup(mats: dict[str, bpy.types.Material]) -> None:
    settings = {
        "carrier": ((0.48, 0.52, 0.50, 1.0), 38.0, 0.05, 0.20, 0.040),
        "cyber_metal": ((0.46, 0.50, 0.48, 1.0), 44.0, 0.06, 0.18, 0.034),
        "metal_edge": ((0.70, 0.68, 0.60, 1.0), 52.0, 0.03, 0.11, 0.025),
        "copper": ((0.58, 0.42, 0.30, 1.0), 48.0, 0.04, 0.13, 0.028),
    }
    for key, (dark_color, scale, factor_min, factor_max, bump_strength) in settings.items():
        mat = mats.get(key)
        if mat is not None:
            apply_machine_surface_breakup_to_material(mat, key, dark_color, scale, factor_min, factor_max, bump_strength)


def apply_machine_surface_breakup_to_material(
    mat: bpy.types.Material,
    material_key: str,
    dark_color: tuple[float, float, float, float],
    scale: float,
    factor_min: float,
    factor_max: float,
    bump_strength: float,
) -> None:
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    if bsdf is None:
        return

    tex_coord = nodes.new(type="ShaderNodeTexCoord")
    tex_coord.name = f"EX_{material_key}_surface_breakup_coords"
    noise = nodes.new(type="ShaderNodeTexNoise")
    noise.name = f"EX_{material_key}_burnished_surface_breakup"
    noise.inputs["Scale"].default_value = scale
    noise.inputs["Detail"].default_value = 9.0
    noise.inputs["Roughness"].default_value = 0.62
    links.new(tex_coord.outputs["Object"], noise.inputs["Vector"])

    factor = map_range_node(nodes, f"EX_{material_key}_surface_grime_factor", 0.20, 1.0, factor_min, factor_max)
    links.new(noise.outputs["Fac"], factor.inputs["Value"])
    base_color = bsdf.inputs.get("Base Color")
    if base_color is not None:
        overlay_color_mix(
            nodes,
            links,
            base_color,
            mat.diffuse_color,
            factor.outputs["Result"],
            dark_color,
            "MULTIPLY",
            f"EX_{material_key}_integrated_surface_grime",
        )

    normal_input = bsdf.inputs.get("Normal")
    if normal_input is not None and not normal_input.links:
        bump = nodes.new(type="ShaderNodeBump")
        bump.name = f"EX_{material_key}_subtle_pitted_bump"
        bump.inputs["Strength"].default_value = bump_strength
        bump.inputs["Distance"].default_value = 0.038
        links.new(noise.outputs["Fac"], bump.inputs["Height"])
        links.new(bump.outputs["Normal"], normal_input)


def overlay_color_mix(
    nodes,
    links,
    base_color,
    base,
    factor_socket,
    target,
    blend_type: str,
    name: str,
) -> None:
    existing_links = list(base_color.links)
    existing_source = existing_links[0].from_socket if existing_links else None
    for link in existing_links:
        links.remove(link)

    mix = nodes.new(type="ShaderNodeMixRGB")
    mix.name = name
    mix.blend_type = blend_type
    mix.inputs[0].default_value = 0.0
    mix.inputs[1].default_value = base
    mix.inputs[2].default_value = target
    if existing_source is not None:
        links.new(existing_source, mix.inputs[1])
    links.new(factor_socket, mix.inputs[0])
    links.new(mix.outputs["Color"], base_color)


def body_torso_attribute_settings(material_key: str) -> tuple[str, tuple[float, float, float, float], float, float, str]:
    settings = {
        "carrier": ("R", (0.044, 0.048, 0.046, 1.0), 0.00, 0.26, "MIX"),
        "carrier_shadow": ("R", (0.008, 0.010, 0.010, 1.0), 0.00, 0.16, "MIX"),
        "phase_skin": ("R", (0.096, 0.064, 0.050, 1.0), 0.06, 0.48, "MIX"),
        "neck_skin": ("R", (0.064, 0.010, 0.009, 1.0), 0.04, 0.28, "MIX"),
        "scar_edge": ("G", (0.006, 0.000, 0.000, 1.0), 0.10, 0.66, "MIX"),
        "muscle": ("G", (0.070, 0.007, 0.005, 1.0), 0.10, 0.42, "MIX"),
        "muscle_gloss": ("G", (0.098, 0.014, 0.009, 1.0), 0.08, 0.36, "MIX"),
        "clot": ("G", (0.004, 0.000, 0.000, 1.0), 0.06, 0.44, "MIX"),
        "tendon": ("B", (0.058, 0.030, 0.022, 1.0), 0.12, 0.54, "MIX"),
        "bone": ("B", (0.064, 0.050, 0.036, 1.0), 0.14, 0.58, "MIX"),
        "cyber_metal": ("R", (0.038, 0.044, 0.042, 1.0), 0.08, 0.46, "MIX"),
        "metal_edge": ("R", (0.082, 0.088, 0.084, 1.0), 0.10, 0.54, "MIX"),
        "copper": ("G", (0.060, 0.120, 0.096, 1.0), 0.04, 0.24, "MIX"),
    }
    return settings.get(material_key, ("R", (0.0, 0.0, 0.0, 1.0), 0.0, 0.0, "MIX"))


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
    uv_map = nodes.new(type="ShaderNodeUVMap")
    uv_map.name = f"EX_{material_key}_mask_projection_uv"
    uv_map.uv_map = MASK_UV_NAME
    links.new(uv_map.outputs["UV"], texture.inputs["Vector"])
    separate = nodes.new(type="ShaderNodeSeparateRGB")
    separate.name = f"EX_{material_key}_mask_channels"
    links.new(texture.outputs["Color"], separate.inputs["Image"])

    base_color = bsdf.inputs.get("Base Color")
    if base_color is not None:
        connect_masked_color_mix(nodes, links, texture, separate, base_color, mat.diffuse_color, material_key)

    if material_key in {
        "head_skin",
        "phase_skin",
        "neck_skin",
        "scar_edge",
        "muscle",
        "muscle_gloss",
        "clot",
        "tendon",
        "bone",
        "cyber_metal",
        "metal_edge",
        "copper",
    }:
        roughness = bsdf.inputs.get("Roughness")
        if roughness is not None:
            roughness_map = nodes.new(type="ShaderNodeMapRange")
            roughness_map.inputs["From Min"].default_value = 0.0
            roughness_map.inputs["From Max"].default_value = 1.0
            if material_key in {"cyber_metal", "metal_edge", "copper"}:
                roughness_map.inputs["To Min"].default_value = 0.38
                roughness_map.inputs["To Max"].default_value = 0.18
                links.new(separate.outputs["R"], roughness_map.inputs["Value"])
            elif material_key in {"head_skin", "phase_skin", "bone"}:
                roughness_map.inputs["To Min"].default_value = 0.68
                roughness_map.inputs["To Max"].default_value = 0.42
                links.new(texture.outputs["Alpha"], roughness_map.inputs["Value"])
            else:
                roughness_map.inputs["To Min"].default_value = 0.44
                roughness_map.inputs["To Max"].default_value = 0.07
                links.new(separate.outputs["G"], roughness_map.inputs["Value"])
            links.new(roughness_map.outputs["Result"], roughness)
        if material_key in {"muscle", "muscle_gloss", "clot"}:
            set_input(bsdf, "Clearcoat", 0.58)
            set_input(bsdf, "Coat Weight", 0.58)
            set_input(bsdf, "Clearcoat Roughness", 0.08)
            set_input(bsdf, "Coat Roughness", 0.08)
        elif material_key in {"neck_skin", "scar_edge", "tendon"}:
            set_input(bsdf, "Clearcoat", 0.24)
            set_input(bsdf, "Coat Weight", 0.24)
            set_input(bsdf, "Clearcoat Roughness", 0.18)
            set_input(bsdf, "Coat Roughness", 0.18)


def apply_torso_blend_material(
    mat: bpy.types.Material,
    mask_image: bpy.types.Image,
    torso_detail_image: bpy.types.Image,
) -> None:
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    if bsdf is None:
        return

    texture = nodes.new(type="ShaderNodeTexImage")
    texture.name = "EX_torso_blend_packed_mask_atlas"
    texture.label = "experiment torso packed RGBA mask atlas"
    texture.image = mask_image
    texture.extension = "REPEAT"
    texture.interpolation = "Cubic"
    uv_map = nodes.new(type="ShaderNodeUVMap")
    uv_map.name = "EX_torso_blend_mask_projection_uv"
    uv_map.uv_map = MASK_UV_NAME
    links.new(uv_map.outputs["UV"], texture.inputs["Vector"])

    detail_texture = nodes.new(type="ShaderNodeTexImage")
    detail_texture.name = "EX_torso_blend_micro_striation_normal"
    detail_texture.label = "experiment torso micro striation normal map"
    detail_texture.image = torso_detail_image
    detail_texture.extension = "REPEAT"
    detail_texture.interpolation = "Cubic"
    links.new(uv_map.outputs["UV"], detail_texture.inputs["Vector"])
    detail_channels = nodes.new(type="ShaderNodeSeparateRGB")
    detail_channels.name = "EX_torso_blend_micro_striation_channels"
    links.new(detail_texture.outputs["Color"], detail_channels.inputs["Image"])

    atlas_channels = nodes.new(type="ShaderNodeSeparateRGB")
    atlas_channels.name = "EX_torso_blend_atlas_channels"
    links.new(texture.outputs["Color"], atlas_channels.inputs["Image"])

    body_attr = nodes.new(type="ShaderNodeAttribute")
    body_attr.name = "EX_torso_blend_body_torso_mask_attr"
    body_attr.attribute_name = BODY_TORSO_MASK_NAME
    body_channels = nodes.new(type="ShaderNodeSeparateRGB")
    body_channels.name = "EX_torso_blend_body_torso_mask_channels"
    links.new(body_attr.outputs["Color"], body_channels.inputs["Image"])

    damage_factor = map_range_node(nodes, "EX_torso_blend_damage_factor", 0.0, 1.0, 0.12, 0.88)
    wet_factor = map_range_node(nodes, "EX_torso_blend_wet_clot_factor", 0.0, 1.0, 0.08, 0.88)
    bone_factor = map_range_node(nodes, "EX_torso_blend_bone_tendon_factor", 0.0, 1.0, 0.00, 0.50)
    body_damage_factor = map_range_node(nodes, "EX_torso_blend_body_damage_factor", 0.0, 1.0, 0.00, 0.96)
    links.new(body_channels.outputs["R"], body_damage_factor.inputs["Value"])
    damage_merge = nodes.new(type="ShaderNodeMath")
    damage_merge.name = "EX_torso_blend_atlas_body_damage_max"
    damage_merge.operation = "MAXIMUM"
    links.new(atlas_channels.outputs["R"], damage_merge.inputs[0])
    links.new(body_damage_factor.outputs["Result"], damage_merge.inputs[1])
    links.new(damage_merge.outputs["Value"], damage_factor.inputs["Value"])

    clot_mix = nodes.new(type="ShaderNodeMath")
    clot_mix.name = "EX_torso_blend_clot_breakup_product"
    clot_mix.operation = "MULTIPLY"
    clot_mix.inputs[1].default_value = 1.0
    links.new(body_channels.outputs["G"], clot_mix.inputs[0])
    links.new(texture.outputs["Alpha"], clot_mix.inputs[1])
    links.new(clot_mix.outputs["Value"], wet_factor.inputs["Value"])

    bone_mix = nodes.new(type="ShaderNodeMath")
    bone_mix.name = "EX_torso_blend_bone_mask_product"
    bone_mix.operation = "MULTIPLY"
    bone_mix.inputs[1].default_value = 1.0
    links.new(body_channels.outputs["B"], bone_mix.inputs[0])
    links.new(atlas_channels.outputs["B"], bone_mix.inputs[1])
    links.new(bone_mix.outputs["Value"], bone_factor.inputs["Value"])

    skin_shred_mix = nodes.new(type="ShaderNodeMath")
    skin_shred_mix.name = "EX_torso_blend_pallid_skin_island_product"
    skin_shred_mix.operation = "MULTIPLY"
    links.new(body_channels.outputs["R"], skin_shred_mix.inputs[0])
    links.new(atlas_channels.outputs["R"], skin_shred_mix.inputs[1])
    skin_shred_factor = map_range_node(nodes, "EX_torso_blend_pallid_skin_island_factor", 0.18, 0.86, 0.00, 0.34)
    links.new(skin_shred_mix.outputs["Value"], skin_shred_factor.inputs["Value"])

    deep_clot_factor = map_range_node(nodes, "EX_torso_blend_deep_clot_pocket_factor", 0.20, 0.92, 0.00, 0.46)
    links.new(clot_mix.outputs["Value"], deep_clot_factor.inputs["Value"])

    metal_to_tissue = mix_rgb_node(
        nodes,
        "EX_torso_blend_metal_to_tissue",
        (0.012, 0.013, 0.013, 1.0),
        (0.100, 0.012, 0.008, 1.0),
    )
    wet_clot = mix_rgb_node(
        nodes,
        "EX_torso_blend_tissue_to_clot",
        (0.100, 0.012, 0.008, 1.0),
        (0.010, 0.000, 0.000, 1.0),
    )
    tendon_bone = mix_rgb_node(
        nodes,
        "EX_torso_blend_clot_to_tendon_bone",
        (0.010, 0.000, 0.000, 1.0),
        (0.170, 0.124, 0.074, 1.0),
    )
    links.new(damage_factor.outputs["Result"], metal_to_tissue.inputs[0])
    links.new(metal_to_tissue.outputs["Color"], wet_clot.inputs[1])
    links.new(wet_factor.outputs["Result"], wet_clot.inputs[0])
    links.new(wet_clot.outputs["Color"], tendon_bone.inputs[1])
    links.new(bone_factor.outputs["Result"], tendon_bone.inputs[0])

    micro_dark_factor = map_range_node(nodes, "EX_torso_blend_micro_clot_factor", 0.32, 0.68, 0.08, 0.72)
    links.new(detail_channels.outputs["R"], micro_dark_factor.inputs["Value"])
    micro_clot = nodes.new(type="ShaderNodeMixRGB")
    micro_clot.name = "EX_torso_blend_micro_clotted_striations"
    micro_clot.blend_type = "MULTIPLY"
    micro_clot.inputs[2].default_value = (0.30, 0.11, 0.09, 1.0)
    links.new(tendon_bone.outputs["Color"], micro_clot.inputs[1])
    links.new(micro_dark_factor.outputs["Result"], micro_clot.inputs[0])

    deep_clot = nodes.new(type="ShaderNodeMixRGB")
    deep_clot.name = "EX_torso_blend_dark_clot_pockets"
    deep_clot.blend_type = "MIX"
    deep_clot.inputs[2].default_value = (0.004, 0.000, 0.000, 1.0)
    links.new(micro_clot.outputs["Color"], deep_clot.inputs[1])
    links.new(deep_clot_factor.outputs["Result"], deep_clot.inputs[0])

    pallid_skin = nodes.new(type="ShaderNodeMixRGB")
    pallid_skin.name = "EX_torso_blend_torn_pallid_skin_islands"
    pallid_skin.blend_type = "MIX"
    pallid_skin.inputs[2].default_value = (0.220, 0.188, 0.154, 1.0)
    links.new(deep_clot.outputs["Color"], pallid_skin.inputs[1])
    links.new(skin_shred_factor.outputs["Result"], pallid_skin.inputs[0])

    base_color = bsdf.inputs.get("Base Color")
    if base_color is not None:
        for link in list(base_color.links):
            links.remove(link)
        links.new(pallid_skin.outputs["Color"], base_color)

    roughness = bsdf.inputs.get("Roughness")
    if roughness is not None:
        roughness_factor = map_range_node(nodes, "EX_torso_blend_roughness_from_wetness", 0.0, 1.0, 0.70, 0.18)
        links.new(clot_mix.outputs["Value"], roughness_factor.inputs["Value"])
        links.new(roughness_factor.outputs["Result"], roughness)
    normal_input = bsdf.inputs.get("Normal")
    if normal_input is not None:
        normal_map = nodes.new(type="ShaderNodeNormalMap")
        normal_map.name = "EX_torso_blend_micro_striation_normal_map"
        normal_map.space = "TANGENT"
        normal_map.inputs["Strength"].default_value = 1.32
        links.new(detail_texture.outputs["Color"], normal_map.inputs["Color"])
        links.new(normal_map.outputs["Normal"], normal_input)
    set_input(bsdf, "Metallic", 0.0)
    set_input(bsdf, "Specular", 0.28)
    set_input(bsdf, "Specular IOR Level", 0.28)
    set_input(bsdf, "Clearcoat", 0.28)
    set_input(bsdf, "Coat Weight", 0.28)
    set_input(bsdf, "Clearcoat Roughness", 0.14)
    set_input(bsdf, "Coat Roughness", 0.14)


def map_range_node(
    nodes,
    name: str,
    from_min: float,
    from_max: float,
    to_min: float,
    to_max: float,
):
    node = nodes.new(type="ShaderNodeMapRange")
    node.name = name
    node.inputs["From Min"].default_value = from_min
    node.inputs["From Max"].default_value = from_max
    node.inputs["To Min"].default_value = to_min
    node.inputs["To Max"].default_value = to_max
    return node


def mix_rgb_node(
    nodes,
    name: str,
    color_a: tuple[float, float, float, float],
    color_b: tuple[float, float, float, float],
):
    node = nodes.new(type="ShaderNodeMixRGB")
    node.name = name
    node.blend_type = "MIX"
    node.inputs[1].default_value = color_a
    node.inputs[2].default_value = color_b
    return node


def connect_masked_color_mix(
    nodes,
    links,
    texture,
    separate,
    base_color,
    base,
    material_key: str,
) -> None:
    channel_name, target, factor_min, factor_max, blend_type = material_mask_color_settings(material_key)
    factor = nodes.new(type="ShaderNodeMapRange")
    factor.name = f"EX_{material_key}_mask_color_factor"
    factor.inputs["From Min"].default_value = 0.0
    factor.inputs["From Max"].default_value = 1.0
    factor.inputs["To Min"].default_value = factor_min
    factor.inputs["To Max"].default_value = factor_max
    mix = nodes.new(type="ShaderNodeMixRGB")
    mix.name = f"EX_{material_key}_mask_color_blend"
    mix.blend_type = blend_type
    mix.inputs[1].default_value = base
    mix.inputs[2].default_value = target
    mask_output = texture.outputs["Alpha"] if channel_name == "A" else separate.outputs[channel_name]
    links.new(mask_output, factor.inputs["Value"])
    links.new(factor.outputs["Result"], mix.inputs[0])
    links.new(mix.outputs["Color"], base_color)


def material_mask_color_settings(material_key: str) -> tuple[str, tuple[float, float, float, float], float, float, str]:
    settings = {
        "head_skin": ("A", (0.145, 0.118, 0.094, 1.0), 0.14, 0.42, "MIX"),
        "phase_skin": ("R", (0.172, 0.132, 0.102, 1.0), 0.10, 0.34, "MIX"),
        "neck_skin": ("R", (0.082, 0.016, 0.014, 1.0), 0.18, 0.56, "MIX"),
        "scar_edge": ("A", (0.005, 0.000, 0.000, 1.0), 0.26, 0.78, "MIX"),
        "muscle": ("G", (0.078, 0.008, 0.006, 1.0), 0.18, 0.56, "MIX"),
        "muscle_gloss": ("G", (0.104, 0.014, 0.010, 1.0), 0.22, 0.62, "MIX"),
        "clot": ("A", (0.006, 0.000, 0.000, 1.0), 0.12, 0.70, "MIX"),
        "tendon": ("G", (0.094, 0.056, 0.038, 1.0), 0.10, 0.26, "MIX"),
        "bone": ("B", (0.120, 0.092, 0.064, 1.0), 0.04, 0.14, "MIX"),
        "cyber_metal": ("R", (0.042, 0.048, 0.046, 1.0), 0.10, 0.34, "MIX"),
        "metal_edge": ("B", (0.235, 0.238, 0.220, 1.0), 0.06, 0.18, "MIX"),
        "copper": ("G", (0.050, 0.185, 0.140, 1.0), 0.06, 0.22, "MIX"),
        "green_glow": ("A", (0.000, 0.260, 0.150, 1.0), 0.02, 0.10, "MIX"),
    }
    return settings.get(material_key, ("A", (0.0, 0.0, 0.0, 1.0), 0.08, 0.25, "MIX"))


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
            and center.z >= reallusion_neck_keep_floor(center)
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


def reallusion_neck_keep_floor(center: Vector) -> float:
    if center.y >= 0.040 or abs(center.x) >= 0.132:
        return CC_NECK_COLLAR_MIN_Z
    front_gate = 1.0 - smoothstep(0.000, 0.050, center.y)
    lateral = smoothstep(0.030, 0.124, abs(center.x))
    lift = 0.014 * front_gate * (1.0 - 0.42 * lateral)
    ripple = 0.0012 * front_gate * math.sin(center.x * 72.0 + center.y * 31.0)
    return CC_NECK_COLLAR_MIN_Z + lift + ripple


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


def apply_body_torso_vertex_mask(obj: bpy.types.Object) -> None:
    mesh = obj.data
    existing = mesh.color_attributes.get(BODY_TORSO_MASK_NAME)
    if existing is not None:
        mesh.color_attributes.remove(existing)
    color_attr = mesh.color_attributes.new(name=BODY_TORSO_MASK_NAME, type="BYTE_COLOR", domain="CORNER")
    for poly in mesh.polygons:
        for loop_index in poly.loop_indices:
            vertex = mesh.vertices[mesh.loops[loop_index].vertex_index]
            color = body_torso_mask_channels(obj.matrix_world @ vertex.co)
            color_attr.data[loop_index].color = color
    mesh.update()


def body_torso_mask_channels(center: Vector) -> tuple[float, float, float, float]:
    front_region = center.y < -0.004 and 1.245 < center.z < 1.590 and abs(center.x) < 0.220
    rear_field = rear_torso_rupture_field(center)
    side_field = side_torso_wrap_field(center)
    lower_transition = lower_body_transition_field(center)
    limb_scarring = limb_transition_scar_field(center)
    if not (front_region or rear_field > 0.01 or side_field > 0.01 or lower_transition > 0.01 or limb_scarring > 0.01):
        return (0.0, 0.0, 0.0, 1.0)

    rupture = front_torso_rupture_field(center) if front_region else 0.0
    feather = front_torso_feather_field(center) if front_region else 0.0
    upper_gate = front_torso_upper_edge_gate(center) if front_region else 1.0
    upper_collar = (
        1.0 - smoothstep(
            0.84,
            1.42,
            ellipsoid(center, (0.008, -0.052, 1.492), (0.172, 0.050, 0.060)),
        )
        if front_region
        else 0.0
    )
    lower_cavity = (
        1.0 - smoothstep(
            0.94,
            1.46,
            ellipsoid(center, (0.026, -0.064, 1.392), (0.104, 0.054, 0.124)),
        )
        if front_region
        else 0.0
    )
    rib_bowl = (
        1.0 - smoothstep(
            0.72,
            1.36,
            ellipsoid(center, (0.020, -0.070, 1.408), (0.134, 0.058, 0.150)),
        )
        if front_region
        else 0.0
    )
    collar_fusion = neck_collar_fusion_field(center)
    neck_chest_bridge = neck_chest_telefrag_transition_field(center)
    field = clamp01(
        max(
            rupture,
            upper_collar * 0.62 * upper_gate,
            lower_cavity * 0.58,
            rib_bowl * 0.54,
            feather * 0.78,
            collar_fusion * 0.76,
            neck_chest_bridge * 0.70,
            rear_field * 0.92,
            side_field * 0.82,
            lower_transition * 0.36,
            limb_scarring * 0.22,
        )
    )
    if field <= 0.01:
        return (0.0, 0.0, 0.0, 1.0)

    rim = max(
        front_torso_rupture_rim(center),
        front_torso_torn_border_field(center) * 0.72,
        neck_collar_fusion_rim(center) * 0.74,
        neck_chest_bridge * 0.44,
        rear_torso_rupture_rim(center) * 0.86,
        side_torso_wrap_rim(center) * 0.72,
        lower_body_transition_rim(center) * 0.38,
        limb_transition_scar_rim(center) * 0.30,
    )
    breakup = 0.5 + 0.5 * organic_breakup(center, 91)
    coarse_islands = 0.5 + 0.5 * organic_breakup(center, 157)
    fine_breakup = 0.5 + 0.5 * math.sin(center.x * 191.0 - center.z * 127.0 + center.y * 43.0)
    tendon_band = (
        diagonal_band_xz(center, (0.000, 1.512), (0.026, 1.372), 0.012)
        or diagonal_band_xz(center, (0.030, 1.480), (-0.032, 1.374), 0.010)
        or diagonal_band_xz(center, (0.058, 1.448), (0.100, 1.374), 0.010)
        or neck_collar_fusion_strand(center)
        or rear_torso_tendon_strand(center)
    )
    bone_hint = 0.82 if telefrag_sternum_bone(center) else 0.0
    if rear_torso_bone_hint(center):
        bone_hint = max(bone_hint, 0.56)
    if tendon_band:
        bone_hint = max(bone_hint, 0.48)

    island_cut = 0.58 + 0.34 * breakup - 0.18 * coarse_islands
    wet_pocket = max(0.0, fine_breakup - 0.26) * (0.56 + 0.36 * breakup)
    damage = clamp01(field * island_cut + rim * 0.24 + neck_chest_bridge * 0.10)
    wetness = clamp01(field * (0.24 + wet_pocket * 0.48) + rim * 0.26 + neck_chest_bridge * 0.08)
    exposed_bone = clamp01(bone_hint + rim * 0.30 + field * (0.06 + coarse_islands * 0.10) + neck_chest_bridge * 0.05)
    if lower_transition > 0.01 or limb_scarring > 0.01:
        transition_noise = 0.5 + 0.5 * organic_breakup(center, 337)
        damage = clamp01(damage + lower_transition * (0.15 + 0.12 * transition_noise) + limb_scarring * (0.08 + 0.08 * transition_noise))
        wetness = clamp01(wetness + lower_transition * 0.08 + limb_scarring * 0.035)
        exposed_bone = clamp01(exposed_bone + lower_body_bone_chip_hint(center) * 0.20)
    return (damage, wetness, exposed_bone, 1.0)


def author_integrated_horror_pass(
    carrier_mesh: bpy.types.Object,
    head_obj: bpy.types.Object,
    accessory_objects: list[bpy.types.Object],
    mats: dict[str, bpy.types.Material],
) -> None:
    refine_front_torso_wound_topology(carrier_mesh)
    refine_rear_torso_wound_topology(carrier_mesh)
    refine_head_telefrag_topology(head_obj)
    assign_body_material_regions(carrier_mesh, mats)
    assign_head_material_regions(head_obj, mats)
    sculpt_head_asymmetry(head_obj)
    sculpt_body_glitch_offsets(carrier_mesh)
    sculpt_neck_collar_fusion(head_obj, carrier_mesh)
    apply_body_torso_vertex_mask(carrier_mesh)
    tone_accessories(accessory_objects, mats)


def material_slot(obj: bpy.types.Object, mat: bpy.types.Material) -> int:
    for index, existing in enumerate(obj.data.materials):
        if existing == mat or (existing is not None and existing.name == mat.name):
            return index
    obj.data.materials.append(mat)
    return len(obj.data.materials) - 1


def refine_head_telefrag_topology(head_obj: bpy.types.Object) -> None:
    mesh = head_obj.data
    if len(mesh.polygons) < 8:
        return

    matrix = head_obj.matrix_world.copy()
    inv_basis = matrix.inverted().to_3x3()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()
    bm.edges.ensure_lookup_table()

    target_edges: set[bmesh.types.BMEdge] = set()
    for face in bm.faces:
        center = matrix @ face.calc_center_median()
        if head_telefrag_refinement_region(center):
            target_edges.update(face.edges)

    if not target_edges:
        bm.free()
        return

    bmesh.ops.subdivide_edges(
        bm,
        edges=list(target_edges),
        cuts=2,
        use_grid_fill=True,
        smooth=0.0,
    )

    bm.verts.ensure_lookup_table()
    for vertex in bm.verts:
        world = matrix @ vertex.co
        if not head_telefrag_refinement_region(world, feather=0.020):
            continue

        front_field = max(
            head_telefrag_transition_field(world),
            head_ruptured_flesh_field(world) * 0.92,
            head_cyber_intrusion_field(world) * 0.86,
            cranial_flayed_scalp_field(world) * 0.82,
            uncanny_left_eye_socket_field(world) * 0.88,
            uncanny_right_eye_wound_field(world) * 0.72,
            readable_mouth_cavity_field(world) * 0.86,
        )
        rear_field = rear_head_rupture_field(world)
        field = max(front_field, rear_field)
        if field <= 0.02:
            continue

        scalp_field = cranial_flayed_scalp_field(world)
        scalp_rim = cranial_flayed_scalp_rim(world)
        rim = max(head_telefrag_transition_rim(world), rear_head_rupture_rim(world), scalp_rim)
        chatter = organic_breakup(world, 203)
        fine = math.sin(world.x * 211.0 - world.z * 157.0 + world.y * 61.0)
        side_bias = smoothstep(0.060, 0.122, abs(world.x))
        front_gate = 1.0 - smoothstep(0.000, 0.070, world.y)
        back_gate = smoothstep(0.026, 0.070, world.y)
        crown_gate = smoothstep(1.675, 1.748, world.z)

        delta = Vector((0.0, 0.0, 0.0))
        delta.y += front_gate * (-0.0048 * front_field + 0.0034 * rim)
        delta.y += back_gate * (0.0038 * rear_field + 0.0016 * rim)
        delta.x += (0.0020 * chatter + 0.0012 * fine) * field * (0.55 + side_bias)
        delta.z += (0.0018 * math.sin(world.x * 173.0 + world.y * 47.0) - 0.0010 * chatter) * rim
        delta.y += crown_gate * (0.0054 * scalp_rim - 0.0096 * scalp_field)
        delta.z += crown_gate * (-0.0056 * scalp_field + 0.0038 * scalp_rim * math.sin(world.x * 131.0))
        delta.x += crown_gate * scalp_field * (0.0034 * math.sin(world.z * 117.0) + 0.0022 * chatter)
        if cranial_scalp_bone(world):
            delta.y += 0.0032 * crown_gate
            delta.z += 0.0024 * crown_gate * math.sin(world.x * 180.0)
        if head_tendon_shred(world):
            delta.y += 0.0038 * front_gate
            delta.z += 0.0018 * math.sin(world.x * 260.0)
        if head_bone_splinter(world):
            delta.y += 0.0022 * front_gate
        if delta.length_squared > 0.0:
            vertex.co += inv_basis @ delta

    bm.to_mesh(mesh)
    bm.free()
    mesh.update()


def head_telefrag_refinement_region(center: Vector, feather: float = 0.0) -> bool:
    if center.z < 1.540 - feather or center.z > 1.812 + feather:
        return False
    if abs(center.x) > 0.136 + feather or center.y > 0.078 + feather:
        return False
    return (
        center.y < -0.010 + feather
        and (
            head_telefrag_transition_field(center) > 0.05
            or head_ruptured_flesh_field(center) > 0.08
            or head_cyber_intrusion_field(center) > 0.08
            or cranial_flayed_scalp_field(center) > 0.05
            or uncanny_left_eye_socket_field(center) > 0.08
            or uncanny_right_eye_wound_field(center) > 0.08
            or readable_mouth_cavity_field(center) > 0.08
        )
    ) or rear_head_rupture_field(center) > 0.06 or cranial_flayed_scalp_field(center) > 0.08


def refine_front_torso_wound_topology(carrier_mesh: bpy.types.Object) -> None:
    mesh = carrier_mesh.data
    if len(mesh.polygons) < 8:
        return

    matrix = carrier_mesh.matrix_world.copy()
    inv_basis = matrix.inverted().to_3x3()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()
    bm.edges.ensure_lookup_table()

    target_edges: set[bmesh.types.BMEdge] = set()
    for face in bm.faces:
        center = matrix @ face.calc_center_median()
        if front_torso_refinement_region(center):
            target_edges.update(face.edges)

    if not target_edges:
        bm.free()
        return

    bmesh.ops.subdivide_edges(
        bm,
        edges=list(target_edges),
        cuts=3,
        use_grid_fill=True,
        smooth=0.0,
    )

    bm.verts.ensure_lookup_table()
    for vertex in bm.verts:
        world = matrix @ vertex.co
        if not front_torso_refinement_region(world, feather=0.030):
            continue
        field = max(
            front_torso_rupture_field(world),
            front_torso_feather_field(world) * 0.56,
            neck_collar_fusion_field(world) * 0.62,
        )
        if field <= 0.0:
            continue

        rim = max(
            front_torso_rupture_rim(world),
            front_torso_torn_border_field(world) * 0.70,
            neck_collar_fusion_rim(world) * 0.74,
        )
        lateral_noise = math.sin(world.z * 73.0 + world.x * 41.0)
        vertical_noise = math.sin(world.x * 118.0 - world.z * 29.0)
        rib_bowl = 1.0 - smoothstep(
            0.72,
            1.36,
            ellipsoid(world, (0.020, -0.070, 1.408), (0.134, 0.058, 0.150)),
        )
        recess = -0.0148 * max(field, rib_bowl * 0.72)
        rim_lift = 0.0082 * rim
        shear = 0.0048 * field * lateral_noise
        z_fray = 0.0038 * rim * vertical_noise
        micro_relief = front_torso_micro_relief(world) * 2.15
        micro_shear = 0.0017 * field * math.sin(world.z * 163.0 - world.x * 87.0)
        if abs(world.x) > 0.070 and rib_bowl > 0.20:
            recess += 0.0068 * rib_bowl
            z_fray += 0.0020 * math.sin(abs(world.x) * 81.0 + world.z * 43.0) * rib_bowl
        vertex.co += inv_basis @ Vector((shear + micro_shear, recess + rim_lift + micro_relief, z_fray))

    bm.to_mesh(mesh)
    bm.free()
    mesh.update()


def refine_rear_torso_wound_topology(carrier_mesh: bpy.types.Object) -> None:
    mesh = carrier_mesh.data
    if len(mesh.polygons) < 8:
        return

    matrix = carrier_mesh.matrix_world.copy()
    inv_basis = matrix.inverted().to_3x3()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()
    bm.edges.ensure_lookup_table()

    target_edges: set[bmesh.types.BMEdge] = set()
    for face in bm.faces:
        center = matrix @ face.calc_center_median()
        if rear_torso_refinement_region(center):
            target_edges.update(face.edges)

    if not target_edges:
        bm.free()
        return

    bmesh.ops.subdivide_edges(
        bm,
        edges=list(target_edges),
        cuts=2,
        use_grid_fill=True,
        smooth=0.0,
    )

    bm.verts.ensure_lookup_table()
    for vertex in bm.verts:
        world = matrix @ vertex.co
        if not rear_torso_refinement_region(world, feather=0.026):
            continue
        field = max(rear_torso_rupture_field(world), side_torso_wrap_field(world) * 0.84)
        if field <= 0.0:
            continue

        rim = max(rear_torso_rupture_rim(world), side_torso_wrap_rim(world) * 0.78)
        side_sign = -1.0 if world.x < 0.0 else 1.0
        back_gate = smoothstep(0.020, 0.082, world.y)
        side_gate = smoothstep(0.132, 0.190, abs(world.x)) * (1.0 - smoothstep(0.080, 0.145, world.y))
        lateral_noise = math.sin(world.z * 81.0 + world.x * 39.0)
        vertical_noise = math.sin(world.x * 104.0 - world.z * 46.0)
        core_sink = -0.0116 * field * back_gate
        lip_lift = 0.0074 * rim * back_gate
        wrap_pull = -side_sign * 0.0052 * side_gate * field
        side_lip = side_sign * 0.0038 * side_gate * rim
        delta = Vector(
            (
                wrap_pull + side_lip + 0.0018 * lateral_noise * field,
                core_sink + lip_lift + 0.0020 * vertical_noise * rim,
                0.0032 * rim * vertical_noise - 0.0018 * field * lateral_noise,
            )
        )
        if rear_torso_bone_hint(world):
            delta.y += 0.0020 * back_gate
            delta.z += 0.0016 * math.sin(world.x * 130.0)
        vertex.co += inv_basis @ delta

    bm.to_mesh(mesh)
    bm.free()
    mesh.update()


def front_torso_refinement_region(center: Vector, feather: float = 0.0) -> bool:
    if center.y >= -0.006 + feather:
        return False
    if not (1.260 - feather < center.z < 1.565 + feather and abs(center.x) < 0.205 + feather):
        return False
    return (
        ellipsoid(center, (0.024, -0.062, 1.414), (0.142 + feather, 0.072 + feather, 0.164 + feather)) < 1.34
        or ellipsoid(center, (0.006, -0.055, 1.496), (0.165 + feather, 0.045 + feather, 0.052 + feather)) < 1.18
        or front_torso_feather_field(center) > 0.20
        or neck_collar_fusion_field(center) > 0.16
    )


def front_torso_rupture_field(center: Vector) -> float:
    core = ellipsoid(center, (0.022, -0.066, 1.412), (0.104, 0.052, 0.132))
    collar = ellipsoid(center, (0.006, -0.055, 1.495), (0.150, 0.034, 0.040)) * 1.08
    rupture = min(core, collar)
    return 1.0 - smoothstep(0.48, 1.16, rupture)


def front_torso_rupture_rim(center: Vector) -> float:
    core = ellipsoid(center, (0.022, -0.066, 1.412), (0.110, 0.054, 0.138))
    collar = ellipsoid(center, (0.006, -0.055, 1.495), (0.154, 0.036, 0.043)) * 1.08
    rupture = min(core, collar)
    return max(0.0, 1.0 - min(abs(rupture - 0.86) / 0.24, 1.0))


def front_torso_feather_field(center: Vector) -> float:
    if not (center.y < -0.004 and 1.255 < center.z < 1.565 and abs(center.x) < 0.212):
        return 0.0

    upper_gate = front_torso_upper_edge_gate(center)
    collar = 1.0 - smoothstep(
        0.76,
        1.58,
        ellipsoid(center, (0.004, -0.053, 1.492), (0.178, 0.052, 0.060)),
    )
    sternum_bridge = 1.0 - smoothstep(
        0.78,
        1.62,
        ellipsoid(center, (0.024, -0.066, 1.414), (0.126, 0.058, 0.158)),
    )
    left_cut = diagonal_band_xz_value(center, (-0.112, 1.492), (0.018, 1.438), 0.018, 0.042)
    right_rip = diagonal_band_xz_value(center, (0.116, 1.486), (0.020, 1.406), 0.017, 0.040)
    throat_drop = diagonal_band_xz_value(center, (0.000, 1.520), (0.030, 1.380), 0.020, 0.050)
    banding = max(left_cut * 0.62, right_rip * 0.58, throat_drop * 0.66)
    breakup = 0.88 + 0.10 * organic_breakup(center, 117)
    shoulder_taper = 0.34 + 0.66 * upper_gate
    return clamp01(max(collar * 0.70 * upper_gate, sternum_bridge * 0.64, banding * shoulder_taper) * breakup)


def front_torso_torn_border_field(center: Vector) -> float:
    feather = front_torso_feather_field(center)
    if feather <= 0.0:
        return 0.0
    rupture = front_torso_rupture_field(center)
    upper_gate = front_torso_upper_edge_gate(center)
    lip = max(0.0, 1.0 - abs(feather - 0.42) / 0.34)
    upper_lip = 1.0 - smoothstep(
        0.72,
        1.26,
        ellipsoid(center, (0.004, -0.053, 1.498), (0.178, 0.050, 0.052)),
    )
    noise = 0.82 + 0.16 * organic_breakup(center, 123)
    return clamp01(
        max(lip, upper_lip * 0.72 * upper_gate, front_torso_rupture_rim(center) * 0.66)
        * noise
        * (1.0 - rupture * 0.28)
    )


def front_torso_upper_edge_gate(center: Vector) -> float:
    if not (center.y < -0.004 and 1.430 < center.z < 1.565 and abs(center.x) < 0.205):
        return 1.0
    lateral = smoothstep(0.038, 0.184, abs(center.x))
    ragged = 0.0018 * organic_breakup(center, 149) + 0.0014 * math.sin(center.x * 57.0 + center.z * 21.0)
    upper_limit = 1.528 - 0.068 * lateral + ragged
    return clamp01(1.0 - smoothstep(upper_limit, upper_limit + 0.035, center.z))


def front_torso_micro_relief(center: Vector) -> float:
    field = front_torso_rupture_field(center)
    if field <= 0.06:
        return 0.0
    diagonal_strand = 0.5 + 0.5 * math.sin(center.x * 166.0 - center.z * 92.0 + math.sin(center.z * 31.0) * 0.9)
    cross_strand = 0.5 + 0.5 * math.sin(center.x * 111.0 + center.z * 57.0 + 0.65)
    wet_pit = 0.5 + 0.5 * math.sin(center.x * 253.0 - center.z * 138.0)
    raised_sinew = smoothstep(0.76, 0.98, diagonal_strand) * 0.0019
    secondary_sinew = smoothstep(0.84, 1.0, cross_strand) * 0.0011
    clotted_groove = smoothstep(0.80, 1.0, wet_pit) * -0.0023
    return field * (raised_sinew + secondary_sinew + clotted_groove)


def rear_torso_refinement_region(center: Vector, feather: float = 0.0) -> bool:
    if not (1.130 - feather < center.z < 1.585 + feather and abs(center.x) < 0.218 + feather):
        return False
    return rear_torso_rupture_field(center) > 0.08 or side_torso_wrap_field(center) > 0.10 or rear_torso_rupture_rim(center) > 0.18


def rear_torso_rupture_field(center: Vector) -> float:
    if not (center.y > 0.020 and 1.145 < center.z < 1.575 and abs(center.x) < 0.205):
        return 0.0
    back_gate = smoothstep(0.018, 0.070, center.y)
    spinal_breach = 1.0 - smoothstep(0.020, 0.074, abs(center.x - rear_spine_wave(center)))
    dorsal_cavity = 1.0 - smoothstep(
        0.52,
        1.30,
        ellipsoid(center, (0.018, 0.080, 1.405), (0.106, 0.058, 0.166)),
    )
    left_scapula_pull = 1.0 - smoothstep(
        0.64,
        1.24,
        ellipsoid(center, (-0.082, 0.074, 1.420), (0.066, 0.046, 0.138)),
    )
    right_flesh_slough = 1.0 - smoothstep(
        0.58,
        1.20,
        ellipsoid(center, (0.086, 0.076, 1.375), (0.072, 0.046, 0.150)),
    )
    diagonal_machine_break = diagonal_band_xz_value(center, (-0.118, 1.520), (0.064, 1.300), 0.022, 0.052)
    tendon_drag = diagonal_band_xz_value(center, (0.106, 1.500), (-0.032, 1.250), 0.018, 0.046)
    breakup = 0.84 + 0.14 * organic_breakup(center, 301)
    return clamp01(
        max(
            spinal_breach * 0.66,
            dorsal_cavity * 0.92,
            left_scapula_pull * 0.54,
            right_flesh_slough * 0.78,
            diagonal_machine_break * 0.82,
            tendon_drag * 0.58,
        )
        * back_gate
        * breakup
    )


def rear_torso_rupture_rim(center: Vector) -> float:
    field = rear_torso_rupture_field(center)
    if field <= 0.0:
        return 0.0
    shell = ellipsoid(center, (0.018, 0.080, 1.405), (0.112, 0.060, 0.174))
    shell_lip = max(0.0, 1.0 - abs(shell - 0.92) / 0.30)
    spine_lip = max(0.0, 1.0 - abs(abs(center.x - rear_spine_wave(center)) - 0.058) / 0.028)
    diagonal_lip = max(
        diagonal_band_xz_value(center, (-0.124, 1.524), (0.070, 1.294), 0.026, 0.038),
        diagonal_band_xz_value(center, (0.112, 1.500), (-0.038, 1.248), 0.022, 0.036),
    )
    return clamp01(max(shell_lip * 0.72, spine_lip * 0.54, diagonal_lip * 0.62, field * 0.26) * (0.88 + 0.10 * organic_breakup(center, 303)))


def side_torso_wrap_field(center: Vector) -> float:
    if not (1.185 < center.z < 1.545 and 0.126 < abs(center.x) < 0.218 and -0.036 < center.y < 0.110):
        return 0.0
    side_sign = -1.0 if center.x < 0.0 else 1.0
    side_gate = smoothstep(0.126, 0.184, abs(center.x))
    depth_gate = smoothstep(-0.040, 0.030, center.y) * (1.0 - smoothstep(0.104, 0.148, center.y))
    shoulder_wrap = diagonal_band_xz_value(center, (side_sign * 0.142, 1.505), (side_sign * 0.182, 1.285), 0.022, 0.050)
    rib_wrap = 1.0 - smoothstep(
        0.62,
        1.24,
        ellipsoid(center, (side_sign * 0.166, 0.034, 1.384), (0.042, 0.074, 0.146)),
    )
    front_bleed = front_torso_feather_field(Vector((center.x * 0.82, -0.030, center.z))) * 0.58
    rear_bleed = rear_torso_rupture_field(Vector((center.x * 0.82, 0.072, center.z))) * 0.70
    breakup = 0.86 + 0.12 * organic_breakup(center, 307)
    return clamp01(max(shoulder_wrap * 0.74, rib_wrap * 0.66, front_bleed, rear_bleed) * side_gate * depth_gate * breakup)


def side_torso_wrap_rim(center: Vector) -> float:
    field = side_torso_wrap_field(center)
    if field <= 0.0:
        return 0.0
    side_sign = -1.0 if center.x < 0.0 else 1.0
    band_lip = diagonal_band_xz_value(center, (side_sign * 0.138, 1.510), (side_sign * 0.188, 1.280), 0.026, 0.034)
    rib_lip = max(0.0, 1.0 - abs(abs(center.x) - 0.168) / 0.034) * smoothstep(1.210, 1.360, center.z)
    return clamp01(max(band_lip * 0.62, rib_lip * 0.46, field * 0.30))


def rear_torso_tendon_strand(center: Vector) -> bool:
    if max(rear_torso_rupture_field(center), side_torso_wrap_field(center)) <= 0.16:
        return False
    return (
        diagonal_band_xz(center, (0.104, 1.500), (-0.034, 1.258), 0.007)
        or diagonal_band_xz(center, (-0.116, 1.504), (0.056, 1.300), 0.007)
        or (abs(center.x - rear_spine_wave(center)) < 0.010 and 1.220 < center.z < 1.535)
    ) and sparse_cell(center, 4)


def rear_torso_bone_hint(center: Vector) -> bool:
    if max(rear_torso_rupture_field(center), side_torso_wrap_field(center)) <= 0.22:
        return False
    vertebral_chip = abs(center.x - rear_spine_wave(center)) < 0.014 and 1.235 < center.z < 1.520
    scapula_chip = (
        diagonal_band_xz(center, (-0.110, 1.478), (-0.030, 1.338), 0.008)
        or diagonal_band_xz(center, (0.104, 1.438), (0.034, 1.292), 0.008)
    )
    return (vertebral_chip or scapula_chip) and sparse_cell(center, 5)


def lower_body_transition_field(center: Vector) -> float:
    if not (-0.060 < center.y < 0.086 and 0.780 < center.z < 1.295 and abs(center.x) < 0.205):
        return 0.0
    front_gate = 1.0 - smoothstep(-0.012, 0.060, center.y)
    side_gate = smoothstep(0.094, 0.178, abs(center.x)) * (1.0 - smoothstep(0.050, 0.100, center.y))
    abdomen_drop = diagonal_band_xz_value(center, (0.028, 1.280), (0.080, 0.980), 0.016, 0.044)
    belt_scrape = diagonal_band_xz_value(center, (-0.128, 1.235), (0.118, 1.125), 0.018, 0.050)
    left_hip_corrosion = 1.0 - smoothstep(
        0.72,
        1.28,
        ellipsoid(center, (-0.105, -0.008, 1.040), (0.062, 0.052, 0.142)),
    )
    right_iliac_scar = diagonal_band_xz_value(center, (0.108, 1.182), (0.034, 0.918), 0.014, 0.040)
    rear_bleed = (
        diagonal_band_xz_value(center, (-0.082, 1.210), (0.066, 1.012), 0.014, 0.038)
        * smoothstep(0.028, 0.080, center.y)
    )
    breakup = 0.88 + 0.10 * organic_breakup(center, 331)
    return clamp01(
        max(
            abdomen_drop * 0.58 * front_gate,
            belt_scrape * 0.50 * max(front_gate, side_gate),
            left_hip_corrosion * 0.46 * max(front_gate, side_gate),
            right_iliac_scar * 0.42 * max(front_gate, side_gate),
            rear_bleed * 0.34,
        )
        * breakup
    )


def lower_body_transition_rim(center: Vector) -> float:
    field = lower_body_transition_field(center)
    if field <= 0.0:
        return 0.0
    belt_lip = diagonal_band_xz_value(center, (-0.136, 1.244), (0.126, 1.120), 0.020, 0.032)
    abdomen_lip = diagonal_band_xz_value(center, (0.020, 1.284), (0.088, 0.978), 0.018, 0.030)
    hip_lip = max(0.0, 1.0 - abs(ellipsoid(center, (-0.105, -0.008, 1.040), (0.064, 0.054, 0.146)) - 0.92) / 0.32)
    return clamp01(max(belt_lip * 0.58, abdomen_lip * 0.52, hip_lip * 0.40, field * 0.28))


def lower_body_bone_chip_hint(center: Vector) -> bool:
    if lower_body_transition_field(center) <= 0.22:
        return False
    hip_chip = diagonal_band_xz(center, (-0.126, 1.122), (-0.060, 1.030), 0.006)
    abdomen_chip = diagonal_band_xz(center, (0.046, 1.190), (0.074, 1.050), 0.005)
    return (hip_chip or abdomen_chip) and sparse_cell(center, 7)


def limb_transition_scar_field(center: Vector) -> float:
    arm_zone = 0.138 < abs(center.x) < 0.360 and 0.680 < center.z < 1.485 and -0.110 < center.y < 0.110
    leg_zone = 0.036 < abs(center.x) < 0.188 and 0.360 < center.z < 1.045 and -0.105 < center.y < 0.095
    if not (arm_zone or leg_zone):
        return 0.0
    side = -1.0 if center.x < 0.0 else 1.0
    if arm_zone:
        upper_arm_rake = diagonal_band_xz_value(center, (side * 0.220, 1.388), (side * 0.286, 1.118), 0.012, 0.032)
        forearm_burn = diagonal_band_xz_value(center, (side * 0.252, 1.060), (side * 0.214, 0.842), 0.010, 0.028)
        outer_forearm_scrape = diagonal_band_xz_value(center, (side * 0.304, 1.142), (side * 0.202, 0.760), 0.014, 0.034)
        elbow_patina = 1.0 - smoothstep(
            0.62,
            1.12,
            ellipsoid(center, (side * 0.250, 0.002, 1.055), (0.050, 0.052, 0.060)),
        )
        return clamp01(max(upper_arm_rake * 0.58, forearm_burn * 0.54, outer_forearm_scrape * 0.50, elbow_patina * 0.36) * (0.86 + 0.12 * organic_breakup(center, 341)))
    thigh_scar = diagonal_band_xz_value(center, (side * 0.104, 0.948), (side * 0.064, 0.690), 0.012, 0.034)
    knee_scrape = diagonal_band_xz_value(center, (side * 0.060, 0.760), (side * 0.136, 0.620), 0.010, 0.028)
    shin_score = diagonal_band_xz_value(center, (side * 0.094, 0.710), (side * 0.070, 0.420), 0.012, 0.030)
    return clamp01(max(thigh_scar * 0.50, knee_scrape * 0.42, shin_score * 0.36) * (0.88 + 0.10 * organic_breakup(center, 343)))


def limb_transition_scar_rim(center: Vector) -> float:
    field = limb_transition_scar_field(center)
    if field <= 0.0:
        return 0.0
    side = -1.0 if center.x < 0.0 else 1.0
    arm_lip = diagonal_band_xz_value(center, (side * 0.226, 1.388), (side * 0.292, 1.112), 0.014, 0.022)
    forearm_lip = diagonal_band_xz_value(center, (side * 0.256, 1.062), (side * 0.218, 0.838), 0.012, 0.020)
    outer_forearm_lip = diagonal_band_xz_value(center, (side * 0.306, 1.142), (side * 0.204, 0.760), 0.016, 0.022)
    thigh_lip = diagonal_band_xz_value(center, (side * 0.106, 0.948), (side * 0.066, 0.690), 0.014, 0.022)
    shin_lip = diagonal_band_xz_value(center, (side * 0.096, 0.710), (side * 0.072, 0.420), 0.014, 0.020)
    return clamp01(max(arm_lip * 0.36, forearm_lip * 0.34, outer_forearm_lip * 0.32, thigh_lip * 0.30, shin_lip * 0.26, field * 0.24))


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
        "torso_blend": material_slot(carrier_mesh, mats["torso_blend"]),
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
        rear_rupture = rear_torso_rupture_field(center)
        rear_rim = rear_torso_rupture_rim(center)
        side_wrap = side_torso_wrap_field(center)
        side_wrap_rim = side_torso_wrap_rim(center)
        lower_transition = lower_body_transition_field(center)
        lower_transition_rim = lower_body_transition_rim(center)
        limb_scarring = limb_transition_scar_field(center)
        limb_scar_rim = limb_transition_scar_rim(center)
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
            if clavicle_outer and center.z > 1.462:
                poly.material_index = slots["scar"] if center.x > -0.010 else slots["metal_edge"]
            else:
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
            if clavicle_edge and center.z > 1.462:
                poly.material_index = slots["scar"] if center.x > -0.010 else slots["metal_edge"]
            else:
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
            poly.material_index = slots["metal_edge"] if rear_fissure(center) else slots["cyber"]
        if rear_scapula_frame:
            poly.material_index = slots["cyber"] if not sparse_cell(center, 10) else slots["copper"]
            if abs(center.x - rear_spine_wave(center)) < 0.040 and sparse_cell(center, 4):
                poly.material_index = slots["clot"]
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
        if rear_rupture > 0.08 or side_wrap > 0.10 or rear_rim > 0.22 or side_wrap_rim > 0.24:
            poly.material_index = polished_back_torso_material(center, slots, poly.material_index)
        if lower_transition > 0.08 or lower_transition_rim > 0.18:
            poly.material_index = polished_lower_transition_material(center, slots, poly.material_index)
        if limb_scarring > 0.08 or limb_scar_rim > 0.18:
            poly.material_index = polished_limb_transition_material(center, slots, poly.material_index)
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

            poly.material_index = polished_front_torso_material(center, slots, poly.material_index)
    smooth_isolated_material_faces(carrier_mesh, {slots["green"]}, passes=3)


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
        "torso_blend": material_slot(head_obj, mats["torso_blend"]),
        "cyber": material_slot(head_obj, mats["cyber_metal"]),
        "metal_edge": material_slot(head_obj, mats["metal_edge"]),
        "copper": material_slot(head_obj, mats["copper"]),
        "optic": material_slot(head_obj, mats["optic_dark"]),
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
            transition = neck_chest_telefrag_transition_field(center)
            collar_fusion = neck_collar_fusion_field(center)
            if transition > 0.18:
                poly.material_index = slots["scar"] if center.x > -0.018 else slots["metal_edge"]
                if neck_chest_tendon_strand(center):
                    poly.material_index = slots["tendon"] if sparse_cell(center, 6) else slots["clot"]
                elif transition > 0.56 and center.x < -0.030:
                    poly.material_index = slots["cyber"] if not sparse_cell(center, 8) else slots["metal_edge"]
                elif transition > 0.48 and wet_highlight_cell(center):
                    poly.material_index = slots["muscle_gloss"]
            if collar_fusion > 0.14 and center.y < 0.016:
                poly.material_index = slots["torso_blend"]
                if center.x < -0.046 and collar_fusion > 0.28:
                    poly.material_index = slots["cyber"] if not sparse_cell(center, 5) else slots["metal_edge"]
                elif center.x > 0.048 and collar_fusion > 0.26:
                    poly.material_index = slots["scar"] if not wet_highlight_cell(center) else slots["muscle_gloss"]
                if neck_collar_fusion_strand(center) and collar_fusion > 0.32:
                    poly.material_index = slots["tendon"] if sparse_cell(center, 8) else slots["clot"]
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
        mouth_cavity = readable_mouth_cavity_field(center)
        mouth_rim = readable_mouth_rim_field(center)
        left_socket_shadow = uncanny_left_eye_socket_field(center)
        left_socket_rim = uncanny_left_eye_socket_rim(center)
        right_socket_wound = uncanny_right_eye_wound_field(center)
        right_socket_rim = uncanny_right_eye_wound_rim(center)
        phase_echo = cranial_phase_echo(center)
        crown_suture = cranial_cyber_suture(center)
        scalp_mottle = cranial_necrotic_mottling(center)
        scalp_flay = cranial_flayed_scalp_field(center)
        scalp_rim = cranial_flayed_scalp_rim(center)
        cranial_shell = cranial_cyber_shell(center)
        cranial_shell_feather = cranial_cyber_shell_feather(center)
        temple_tear = side and center.x < -0.040 and 1.622 < center.z < 1.742 and abs(center.y - 0.000) < 0.042

        if scalp_flay > 0.10:
            if scalp_rim > 0.42:
                poly.material_index = slots["scar"] if center.x > -0.012 else slots["metal_edge"]
                if cranial_scalp_tendon(center):
                    poly.material_index = slots["tendon"]
            elif scalp_flay > 0.62:
                poly.material_index = slots["muscle"] if center.x > -0.020 else slots["cyber"]
                if wet_highlight_cell(center) and center.x > -0.020:
                    poly.material_index = slots["muscle_gloss"]
                if cranial_scalp_bone(center):
                    poly.material_index = slots["bone"]
                elif sparse_cell(center, 9):
                    poly.material_index = slots["clot"]
            else:
                poly.material_index = slots["phase_skin"] if center.x > -0.024 else slots["metal_edge"]
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
            if cranial_green_spark(center) and scalp_flay > 0.46:
                poly.material_index = slots["green"]
        if scalp_flay > 0.12:
            if scalp_rim > 0.44:
                poly.material_index = slots["scar"] if center.x > -0.014 else slots["metal_edge"]
                if cranial_scalp_tendon(center):
                    poly.material_index = slots["tendon"]
            elif scalp_flay > 0.64:
                poly.material_index = slots["muscle"] if center.x > -0.020 else slots["cyber"]
                if wet_highlight_cell(center) and center.x > -0.020:
                    poly.material_index = slots["muscle_gloss"]
                if cranial_scalp_bone(center):
                    poly.material_index = slots["bone"]
                elif sparse_cell(center, 9):
                    poly.material_index = slots["clot"]
            else:
                poly.material_index = slots["phase_skin"] if center.x > -0.024 else slots["metal_edge"]
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
                poly.material_index = slots["metal_edge"] if sparse_cell(center, 5) else slots["cyber"]
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
                poly.material_index = slots["metal_edge"] if sparse_cell(center, 4) else slots["cyber"]
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
        if left_socket_shadow > 0.14:
            if left_socket_shadow > 0.68:
                poly.material_index = slots["optic"] if center.x > -0.064 else slots["cyber"]
                if cyber_eye_cut(center) and left_socket_shadow < 0.86:
                    poly.material_index = slots["metal_edge"]
            elif left_socket_rim > 0.34:
                poly.material_index = slots["metal_edge"] if center.z > 1.666 else slots["cyber"]
        if right_socket_wound > 0.12:
            if right_socket_wound > 0.66:
                poly.material_index = slots["clot"] if center.z < 1.667 or human_eye_blood_pool(center) else slots["scar"]
                if wet_highlight_cell(center) and center.z > 1.668:
                    poly.material_index = slots["muscle_gloss"]
            elif right_socket_rim > 0.32:
                poly.material_index = slots["scar"] if not sparse_cell(center, 10) else slots["tendon"]
        if mouth_cavity > 0.10:
            if mouth_cavity > 0.66:
                poly.material_index = slots["clot"]
                if center.x < -0.030 and sparse_cell(center, 5):
                    poly.material_index = slots["optic"]
                elif center.x > 0.036 and wet_highlight_cell(center):
                    poly.material_index = slots["muscle_gloss"]
            elif mouth_rim > 0.34:
                if readable_mouth_tendon_strand(center):
                    poly.material_index = slots["tendon"] if not sparse_cell(center, 6) else slots["bone"]
                else:
                    poly.material_index = slots["scar"] if center.x > -0.018 else slots["metal_edge"]
        if temple_tear:
            poly.material_index = slots["cyber"] if sparse_cell(center, 2) else slots["metal_edge"]
            if cranial_green_spark(center):
                poly.material_index = slots["green"]
        if rear_occipital_rift:
            poly.material_index = slots["scar"] if sparse_cell(center, 4) else slots["cyber"]
            if rear_head_fissure(center):
                poly.material_index = slots["metal_edge"] if not sparse_cell(center, 5) else slots["clot"]
            elif rear_head_rupture_rim(center) > 0.48 and sparse_cell(center, 3):
                poly.material_index = slots["tendon"] if center.z < 1.690 else slots["metal_edge"]
            elif sparse_cell(center, 5):
                poly.material_index = slots["clot"]
        if center.z > 1.706 and center.y < 0.064 and poly.material_index in {slots["skin"], slots["phase_skin"]}:
            cap_noise = organic_breakup(center, 207)
            if abs(center.x) < 0.092 and cap_noise > -0.46:
                poly.material_index = slots["scar"] if cap_noise < 0.34 else slots["muscle"]
            if center.x < -0.024 and cap_noise > -0.08:
                poly.material_index = slots["metal_edge"]
            if center.x > 0.036 and cap_noise > 0.22:
                poly.material_index = slots["clot"] if sparse_cell(center, 5) else slots["muscle_gloss"]
        if cranial_embedded_fragment(center) and poly.material_index not in {slots["lash"], slots["green"]}:
            if center.x < -0.014:
                poly.material_index = slots["metal_edge"] if not sparse_cell(center, 4) else slots["cyber"]
            elif sparse_cell(center, 3):
                poly.material_index = slots["tendon"]
            else:
                poly.material_index = slots["clot"] if center.z < 1.750 else slots["scar"]
        poly.material_index = polished_cheek_material(center, slots, poly.material_index)
        poly.material_index = polished_head_telefrag_material(center, slots, poly.material_index)
    smooth_isolated_material_faces(head_obj, {slots["lash"], slots["green"]}, passes=3)


def polished_lower_transition_material(center: Vector, slots: dict[str, int], fallback: int) -> int:
    field = lower_body_transition_field(center)
    rim = lower_body_transition_rim(center)
    if field <= 0.08 and rim <= 0.18:
        return fallback

    metal_side = center.x < -0.018
    flesh_side = center.x > 0.032
    if lower_body_bone_chip_hint(center) and field > 0.34:
        return slots["bone"] if sparse_cell(center, 11) else slots["tendon"]
    if field > 0.56:
        if metal_side:
            return slots["cyber"] if not sparse_cell(center, 6) else slots["metal_edge"]
        if flesh_side and center.y < 0.018:
            return slots["scar"] if not wet_highlight_cell(center) else slots["muscle_gloss"]
        return slots["torso_blend"]
    if field > 0.32:
        if metal_side:
            return slots["metal_edge"] if not copper_transition(center, (-0.100, -0.008, 1.050), (0.090, 0.064, 0.174)) else slots["copper"]
        if flesh_side:
            return slots["scar"] if not sparse_cell(center, 8) else slots["clot"]
        return slots["torso_blend"]
    if rim > 0.28:
        if fallback in {slots["carrier"], slots["shadow"], slots["cyber"], slots["metal_edge"]}:
            return slots["metal_edge"] if not sparse_cell(center, 7) else slots["copper"]
        if fallback in {slots["phase_skin"], slots["scar"], slots["muscle"], slots["muscle_gloss"]}:
            return slots["scar"] if not wet_highlight_cell(center) else slots["muscle_gloss"]
        return slots["torso_blend"] if sparse_cell(center, 4) else fallback
    if fallback in {slots["carrier"], slots["shadow"]} and sparse_cell(center, 3):
        return slots["torso_blend"] if center.y < 0.020 else slots["cyber"]
    return fallback


def polished_limb_transition_material(center: Vector, slots: dict[str, int], fallback: int) -> int:
    field = limb_transition_scar_field(center)
    rim = limb_transition_scar_rim(center)
    if field <= 0.10 and rim <= 0.20:
        return fallback

    arm_zone = 0.176 < abs(center.x) < 0.330 and 0.780 < center.z < 1.445
    left_side = center.x < 0.0
    if field > 0.34:
        if arm_zone and not left_side:
            return slots["scar"] if not wet_highlight_cell(center) else slots["muscle_gloss"]
        if sparse_cell(center, 9):
            return slots["copper"]
        return slots["cyber"] if left_side else slots["metal_edge"]
    if rim > 0.22:
        if arm_zone and not left_side and sparse_cell(center, 5):
            return slots["scar"]
        return slots["metal_edge"] if not sparse_cell(center, 8) else slots["copper"]
    if fallback in {slots["carrier"], slots["shadow"]} and sparse_cell(center, 4):
        return slots["copper"] if left_side else slots["metal_edge"]
    return fallback


def polished_back_torso_material(center: Vector, slots: dict[str, int], fallback: int) -> int:
    if not (1.145 < center.z < 1.575 and abs(center.x) < 0.220 and -0.040 < center.y < 0.150):
        return fallback

    rear_field = rear_torso_rupture_field(center)
    rear_rim = rear_torso_rupture_rim(center)
    side_field = side_torso_wrap_field(center)
    side_rim = side_torso_wrap_rim(center)
    field = max(rear_field, side_field * 0.90)
    rim = max(rear_rim, side_rim * 0.82)
    if field <= 0.06 and rim <= 0.16:
        return fallback

    side_zone = side_field > rear_field * 0.82 and abs(center.x) > 0.128
    metal_bias = center.x < rear_spine_wave(center) - 0.014
    flesh_bias = center.x > rear_spine_wave(center) + 0.018
    tendon = rear_torso_tendon_strand(center)
    bone = rear_torso_bone_hint(center)
    fissure = rear_fissure(center) or (
        side_zone and diagonal_band_xz(center, (0.156 if center.x > 0.0 else -0.156, 1.500), (0.188 if center.x > 0.0 else -0.188, 1.282), 0.006)
    )

    if bone and field > 0.22:
        return slots["bone"] if not tendon else slots["tendon"]
    if tendon and (field > 0.24 or rim > 0.32):
        return slots["tendon"] if not wet_highlight_cell(center) else slots["muscle_gloss"]
    if fissure and field > 0.34:
        return slots["clot"] if flesh_bias or sparse_cell(center, 5) else slots["metal_edge"]

    if field > 0.62:
        if side_zone and center.x > 0.0:
            return slots["muscle_gloss"] if wet_highlight_cell(center) else slots["muscle"]
        if metal_bias:
            return slots["cyber"] if not sparse_cell(center, 7) else slots["metal_edge"]
        if flesh_bias:
            return slots["clot"] if sparse_cell(center, 4) else slots["muscle"]
        return slots["clot"]

    if field > 0.36:
        if side_zone:
            return slots["torso_blend"] if not sparse_cell(center, 4) else (slots["scar"] if center.x > 0.0 else slots["metal_edge"])
        if metal_bias:
            return slots["cyber"] if not sparse_cell(center, 6) else slots["copper"]
        if flesh_bias:
            return slots["muscle"] if not wet_highlight_cell(center) else slots["muscle_gloss"]
        return slots["torso_blend"]

    if rim > 0.30:
        if metal_bias and not side_zone:
            return slots["metal_edge"] if not sparse_cell(center, 5) else slots["copper"]
        if flesh_bias or center.x > 0.035:
            return slots["scar"] if not wet_highlight_cell(center) else slots["muscle_gloss"]
        return slots["torso_blend"]

    if field > 0.12:
        if fallback in {slots["carrier"], slots["shadow"], slots["cyber"], slots["metal_edge"], slots["scar"], slots["muscle"], slots["clot"], slots["tendon"], slots["bone"]}:
            return slots["torso_blend"] if fallback in {slots["carrier"], slots["shadow"]} or sparse_cell(center, 3) else fallback
        return slots["torso_blend"]

    return fallback


def polished_front_torso_material(center: Vector, slots: dict[str, int], fallback: int) -> int:
    if not (center.y < -0.012 and 1.315 < center.z < 1.535 and abs(center.x) < 0.160):
        return fallback

    field = front_torso_rupture_field(center)
    rim = front_torso_rupture_rim(center)
    feather = front_torso_feather_field(center)
    torn_border = front_torso_torn_border_field(center)
    upper_gate = front_torso_upper_edge_gate(center)
    outer_shell = (
        ellipsoid(center, (0.020, -0.060, 1.420), (0.128, 0.056, 0.138)) < 1.22
        or feather > 0.16
    ) and (center.z < 1.458 or upper_gate > 0.12)
    if field <= 0.02 and feather <= 0.10 and not outer_shell:
        return fallback

    split = 0.008 + 0.024 * math.sin((center.z - 1.385) * 16.0)
    seam_width = 0.010 + 0.018 * field
    seam = abs(center.x - split) < seam_width
    metal_side = center.x < split - seam_width * 0.55
    flesh_side = center.x > split + seam_width * 0.55
    upper_lip = center.z > 1.468 and rim > 0.32
    tendon_strand = (
        diagonal_band_xz(center, (0.000, 1.500), (0.034, 1.365), 0.006)
        or diagonal_band_xz(center, (0.022, 1.486), (-0.018, 1.372), 0.005)
        or diagonal_band_xz(center, (0.050, 1.454), (0.090, 1.374), 0.005)
        or neck_collar_fusion_strand(center)
    )
    collar_fusion = neck_collar_fusion_field(center)
    collar_rim = neck_collar_fusion_rim(center)

    if collar_fusion > 0.16:
        if neck_collar_green_spark(center):
            return slots["green"]
        if neck_collar_fusion_strand(center) and collar_fusion > 0.34 and sparse_cell(center, 8):
            return slots["tendon"] if center.x > -0.020 else slots["metal_edge"]
        if collar_rim > 0.54:
            if center.x < -0.042:
                return slots["metal_edge"] if sparse_cell(center, 6) else slots["cyber"]
            if center.x > 0.048:
                return slots["scar"] if not wet_highlight_cell(center) else slots["muscle_gloss"]
        return slots["torso_blend"]

    patch_edge_unifier = max(field, feather * 0.90, rim * 0.76, torn_border * 0.72)
    patch_edge_candidate = fallback in {
        slots["phase_skin"],
        slots["scar"],
        slots["muscle"],
        slots["muscle_gloss"],
        slots["clot"],
        slots["tendon"],
        slots["bone"],
        slots["cyber"],
        slots["metal_edge"],
    }
    if patch_edge_candidate and patch_edge_unifier > 0.075:
        if telefrag_sternum_fissure(center) and field > 0.64 and sparse_cell(center, 5):
            return slots["green"]
        if tendon_strand and patch_edge_unifier > 0.42 and sparse_cell(center, 12):
            return slots["tendon"]
        if metal_side and patch_edge_unifier < 0.12 and center.z < 1.440:
            return slots["cyber"]
        return slots["torso_blend"]

    shoulder_edge_cleanup = center.z > 1.462 and abs(center.x) > 0.052 and upper_gate < 0.34
    upper_clavicle_fringe = center.z > 1.470 and abs(center.x) > 0.030 and (
        upper_gate < 0.84
        or fallback in {slots["phase_skin"], slots["scar"], slots["torso_blend"], slots["tendon"], slots["bone"]}
    )
    if upper_clavicle_fringe:
        fringe_unifier = max(field, feather, rim * 0.82, torn_border * 0.74, collar_rim * 0.70)
        if fringe_unifier > 0.16 or fallback == slots["torso_blend"]:
            return slots["torso_blend"]
        if metal_side:
            return slots["metal_edge"] if upper_gate > 0.22 or sparse_cell(center, 6) else slots["cyber"]
        return slots["scar"] if upper_gate > 0.28 or sparse_cell(center, 9) else slots["phase_skin"]

    if shoulder_edge_cleanup:
        if fallback in {
            slots["torso_blend"],
            slots["phase_skin"],
            slots["scar"],
            slots["muscle"],
            slots["muscle_gloss"],
            slots["clot"],
            slots["tendon"],
            slots["bone"],
        }:
            if metal_side:
                return slots["metal_edge"] if upper_gate > 0.18 else slots["cyber"]
            return slots["scar"] if upper_gate > 0.18 else slots["phase_skin"]
        return fallback

    blend_zone = (
        field > 0.08
        or rim > 0.24
        or feather > 0.16
        or torn_border > 0.22
        or (outer_shell and center.z > 1.455 and upper_gate > 0.18)
    )
    if blend_zone:
        if telefrag_sternum_fissure(center) and field > 0.68 and sparse_cell(center, 5):
            return slots["green"]
        if tendon_strand and (field > 0.48 or torn_border > 0.58) and sparse_cell(center, 7):
            return slots["tendon"]
        if metal_side and max(rim, torn_border) > 0.70 and sparse_cell(center, 10):
            return slots["metal_edge"]
        return slots["torso_blend"]

    if field <= 0.14:
        if fallback == slots["phase_skin"]:
            return slots["scar"] if flesh_side else slots["metal_edge"]
        if fallback == slots["bone"]:
            return slots["tendon"]
        return fallback

    if rim > 0.58 and field < 0.52:
        if upper_lip and seam:
            return slots["tendon"] if tendon_strand else slots["clot"]
        if metal_side:
            return slots["metal_edge"] if not sparse_cell(center, 13) else slots["copper"]
        return slots["scar"] if flesh_side else slots["metal_edge"]

    if field < 0.36:
        if seam:
            return slots["tendon"] if tendon_strand else slots["clot"]
        if metal_side:
            return slots["cyber"] if not copper_transition(center, (-0.058, -0.054, 1.425), (0.104, 0.060, 0.120)) else slots["copper"]
        return slots["scar"] if not wet_highlight_cell(center) else slots["muscle_gloss"]

    if field < 0.68:
        if seam:
            return slots["tendon"] if tendon_strand else slots["clot"]
        if metal_side:
            return slots["cyber"] if not sparse_cell(center, 17) else slots["metal_edge"]
        return slots["muscle"] if not wet_highlight_cell(center) else slots["muscle_gloss"]

    central_clot = ellipsoid(center, (0.024, -0.067, 1.414), (0.050, 0.032, 0.070)) < 1.0
    if central_clot or seam:
        if telefrag_sternum_fissure(center) and sparse_cell(center, 5):
            return slots["green"]
        if telefrag_sternum_bone(center) and tendon_strand:
            return slots["tendon"]
        return slots["tendon"] if tendon_strand else slots["clot"]

    if metal_side:
        return slots["cyber"] if not sparse_cell(center, 9) else slots["metal_edge"]

    if flesh_side:
        return slots["muscle_gloss"] if wet_highlight_cell(center) else slots["muscle"]

    return slots["clot"]


def polished_head_telefrag_material(center: Vector, slots: dict[str, int], fallback: int) -> int:
    if not (1.540 < center.z < 1.812 and center.y < 0.080 and abs(center.x) < 0.136):
        return fallback

    back = center.y > 0.032
    if back:
        rear_field = rear_head_rupture_field(center)
        rear_rim = rear_head_rupture_rim(center)
        if rear_field <= 0.08:
            return fallback
        if rear_head_fissure(center):
            return slots["metal_edge"] if not sparse_cell(center, 5) else slots["clot"]
        if head_tendon_shred(center) and rear_rim > 0.36:
            return slots["tendon"]
        if rear_field > 0.68:
            return slots["clot"] if sparse_cell(center, 4) else slots["cyber"]
        if rear_rim > 0.44:
            return slots["metal_edge"] if sparse_cell(center, 3) else slots["scar"]
        return slots["phase_skin"] if sparse_cell(center, 5) else fallback

    if center.y > 0.026 and head_cyber_intrusion_field(center) < 0.20:
        return fallback

    seam_x = head_telefrag_boundary_x(center)
    transition = head_telefrag_transition_field(center)
    rim = head_telefrag_transition_rim(center)
    cyber = head_cyber_intrusion_field(center)
    flesh = head_ruptured_flesh_field(center)
    left_socket = uncanny_left_eye_socket_field(center)
    left_socket_rim = uncanny_left_eye_socket_rim(center)
    right_socket = uncanny_right_eye_wound_field(center)
    right_socket_rim = uncanny_right_eye_wound_rim(center)
    mouth_cavity = readable_mouth_cavity_field(center)
    mouth_rim = readable_mouth_rim_field(center)
    if left_socket > 0.12:
        if left_socket > 0.70:
            return slots["optic"] if center.x > -0.066 else slots["cyber"]
        if left_socket_rim > 0.36:
            return slots["metal_edge"] if center.z > 1.664 else slots["cyber"]
    if right_socket > 0.12:
        if right_socket > 0.68:
            if human_eye_blood_pool(center) or center.z < 1.666:
                return slots["clot"]
            return slots["muscle_gloss"] if wet_highlight_cell(center) else slots["scar"]
        if right_socket_rim > 0.34:
            return slots["scar"] if not readable_mouth_tendon_strand(center) else slots["tendon"]
    if mouth_cavity > 0.12:
        if mouth_cavity > 0.68:
            if center.x < -0.036 and sparse_cell(center, 7):
                return slots["optic"]
            if readable_mouth_tendon_strand(center) and center.z > 1.604:
                return slots["tendon"]
            return slots["clot"]
        if mouth_rim > 0.36:
            if readable_mouth_tendon_strand(center):
                return slots["tendon"] if not sparse_cell(center, 6) else slots["bone"]
            return slots["metal_edge"] if center.x < -0.018 else slots["scar"]
    field = max(transition, cyber * 0.92, flesh * 0.96)
    if field <= 0.05:
        return fallback

    metal_bias = center.x < seam_x - 0.010
    flesh_bias = center.x > seam_x + 0.010
    cross_metal = head_crossing_metal_shard(center)
    cross_flesh = head_crossing_flesh_tear(center)
    tendon = head_tendon_shred(center)
    bone = head_bone_splinter(center)
    island_breakup = head_material_island_breakup_field(center)

    if head_sparse_glitch_fissure(center) and field > 0.58 and sparse_cell(center, 7):
        return slots["green"]
    if island_breakup > 0.58 and fallback in {slots["skin"], slots["phase_skin"], slots["cyber"], slots["metal_edge"], slots["scar"], slots["muscle"], slots["muscle_gloss"], slots["clot"]}:
        if island_breakup > 0.78 and sparse_cell(center, 4):
            return slots["clot"] if flesh_bias else slots["cyber"]
        if tendon and island_breakup > 0.60:
            return slots["tendon"]
        if fallback in {slots["cyber"], slots["metal_edge"]}:
            return slots["scar"] if sparse_cell(center, 5) else slots["metal_edge"]
        if fallback in {slots["scar"], slots["muscle"], slots["muscle_gloss"], slots["clot"]} and sparse_cell(center, 6):
            return slots["metal_edge"] if center.x < seam_x else slots["tendon"]
        return slots["scar"] if not wet_highlight_cell(center) else slots["muscle_gloss"]
    if bone and field > 0.28:
        return slots["bone"] if not tendon else slots["tendon"]
    if tendon and (rim > 0.22 or transition > 0.32):
        return slots["tendon"] if not wet_highlight_cell(center) else slots["muscle_gloss"]
    if cross_metal:
        if rim > 0.48 and sparse_cell(center, 7):
            return slots["clot"]
        return slots["metal_edge"] if rim > 0.30 or sparse_cell(center, 4) else slots["cyber"]
    if cross_flesh:
        if cheek_blood_crack(center) or wet_highlight_cell(center):
            return slots["muscle_gloss"] if wet_highlight_cell(center) else slots["clot"]
        return slots["muscle"] if field > 0.42 else slots["scar"]

    if transition > 0.42:
        if abs(center.x - seam_x) < 0.016:
            if sparse_cell(center, 5):
                return slots["tendon"]
            return slots["clot"] if center.z < 1.650 else slots["metal_edge"]
        if metal_bias:
            return slots["cyber"] if not sparse_cell(center, 6) else slots["metal_edge"]
        if flesh_bias:
            return slots["muscle_gloss"] if wet_highlight_cell(center) else slots["muscle"]

    if rim > 0.34:
        if metal_bias and sparse_cell(center, 3):
            return slots["scar"]
        if flesh_bias and sparse_cell(center, 4):
            return slots["metal_edge"]
        return slots["scar"] if flesh_bias else slots["metal_edge"]

    if cyber > 0.56 and flesh < 0.50:
        return slots["cyber"] if not sparse_cell(center, 8) else slots["copper"]
    if flesh > 0.48:
        return slots["muscle"] if not wet_highlight_cell(center) else slots["muscle_gloss"]
    if field > 0.18 and fallback == slots["skin"]:
        return slots["phase_skin"] if not sparse_cell(center, 3) else slots["scar"]
    return fallback


def polished_cheek_material(center: Vector, slots: dict[str, int], fallback: int) -> int:
    if not (center.y < -0.022 and 0.012 < center.x < 0.116 and 1.555 < center.z < 1.656):
        return fallback
    if ellipsoid(center, (0.047, -0.064, 1.666), (0.060, 0.032, 0.044)) < 0.76:
        return fallback

    cheek = ellipsoid(center, (0.070, -0.061, 1.612), (0.070, 0.039, 0.067))
    jaw = ellipsoid(center, (0.052, -0.066, 1.579), (0.064, 0.030, 0.040))
    tear = min(cheek, jaw)
    if tear > 1.18:
        return fallback

    tendon_fan = (
        diagonal_band_xz(center, (0.034, 1.636), (0.098, 1.588), 0.010)
        or diagonal_band_xz(center, (0.040, 1.620), (0.104, 1.570), 0.008)
    )
    blood_crack = cheek_blood_crack(center)

    if tear > 0.90:
        return slots["scar"] if center.z < 1.640 else slots["phase_skin"]
    if tear > 0.62:
        if blood_crack:
            return slots["clot"]
        return slots["tendon"] if tendon_fan else slots["scar"]
    if tendon_fan:
        return slots["tendon"] if not sparse_cell(center, 5) else slots["bone"]
    if blood_crack or ellipsoid(center, (0.076, -0.067, 1.604), (0.030, 0.021, 0.032)) < 0.88:
        return slots["clot"]
    return slots["muscle_gloss"] if wet_highlight_cell(center) else slots["muscle"]


def head_material_island_breakup_field(center: Vector) -> float:
    if not (center.y < 0.030 and 1.560 < center.z < 1.748 and abs(center.x) < 0.124):
        return 0.0
    seam_x = head_telefrag_boundary_x(center)
    seam_drag = 1.0 - smoothstep(0.018, 0.072, abs(center.x - seam_x))
    brow_rake = diagonal_band_xz_value(center, (-0.082, 1.700), (0.086, 1.668), 0.012, 0.042)
    cheek_rake = diagonal_band_xz_value(center, (-0.094, 1.642), (0.102, 1.596), 0.014, 0.046)
    jaw_rake = diagonal_band_xz_value(center, (-0.064, 1.592), (0.070, 1.560), 0.012, 0.036)
    socket_bleed = max(
        1.0 - smoothstep(0.70, 1.12, ellipsoid(center, (-0.044, -0.064, 1.674), (0.064, 0.032, 0.044))),
        1.0 - smoothstep(0.70, 1.12, ellipsoid(center, (0.047, -0.064, 1.666), (0.064, 0.033, 0.045))),
    )
    breakup = 0.82 + 0.16 * organic_breakup(center, 229)
    return clamp01(max(seam_drag * 0.56, brow_rake * 0.42, cheek_rake * 0.48, jaw_rake * 0.36, socket_bleed * 0.22) * breakup)


def smooth_isolated_material_faces(
    obj: bpy.types.Object,
    locked_indices: set[int],
    passes: int = 1,
) -> None:
    """Remove single-face material noise while preserving deliberate locked highlights."""
    mesh = obj.data
    if len(mesh.polygons) < 4:
        return

    edge_to_faces: dict[tuple[int, int], list[int]] = defaultdict(list)
    for poly in mesh.polygons:
        for edge_key in poly.edge_keys:
            edge_to_faces[tuple(sorted(edge_key))].append(poly.index)

    neighbors: list[set[int]] = [set() for _ in mesh.polygons]
    for face_indices in edge_to_faces.values():
        if len(face_indices) < 2:
            continue
        for face_index in face_indices:
            neighbors[face_index].update(other for other in face_indices if other != face_index)

    for _ in range(passes):
        current = [poly.material_index for poly in mesh.polygons]
        updates: dict[int, int] = {}
        for poly in mesh.polygons:
            own_material = current[poly.index]
            if own_material in locked_indices:
                continue
            neighbor_indices = neighbors[poly.index]
            if len(neighbor_indices) < 3:
                continue
            counts = Counter(
                current[index]
                for index in neighbor_indices
                if current[index] not in locked_indices
            )
            if not counts:
                continue
            dominant_material, dominant_count = counts.most_common(1)[0]
            if dominant_material == own_material:
                continue
            own_count = counts.get(own_material, 0)
            required_count = max(3, len(neighbor_indices) - 1)
            if dominant_count >= required_count and own_count <= 1:
                updates[poly.index] = dominant_material
        if not updates:
            break
        for poly_index, material_index in updates.items():
            mesh.polygons[poly_index].material_index = material_index


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


def diagonal_band_xz_value(
    center: Vector,
    start: tuple[float, float],
    end: tuple[float, float],
    width: float,
    feather: float,
) -> float:
    px = center.x
    pz = center.z
    sx, sz = start
    ex, ez = end
    vx = ex - sx
    vz = ez - sz
    length_sq = vx * vx + vz * vz
    if length_sq <= 0.000001:
        distance = math.hypot(px - sx, pz - sz)
    else:
        t = max(0.0, min(1.0, ((px - sx) * vx + (pz - sz) * vz) / length_sq))
        closest_x = sx + vx * t
        closest_z = sz + vz * t
        distance = math.hypot(px - closest_x, pz - closest_z)
    return 1.0 - smoothstep(width, width + feather, distance)


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


def head_telefrag_boundary_x(center: Vector) -> float:
    return (
        -0.012
        + 0.022 * math.sin((center.z - 1.575) * 21.0)
        + 0.012 * math.sin(center.y * 53.0 + center.z * 14.0)
        + 0.008 * organic_breakup(center, 177)
    )


def head_telefrag_transition_field(center: Vector) -> float:
    if not (center.y < 0.036 and 1.548 < center.z < 1.765 and abs(center.x) < 0.124):
        return 0.0
    seam_x = head_telefrag_boundary_x(center)
    seam = 1.0 - smoothstep(0.012, 0.052, abs(center.x - seam_x))
    brow = diagonal_band_xz_value(center, (-0.085, 1.704), (0.058, 1.674), 0.018, 0.044)
    cheek = diagonal_band_xz_value(center, (-0.080, 1.638), (0.092, 1.594), 0.018, 0.046)
    jaw = diagonal_band_xz_value(center, (-0.046, 1.590), (0.068, 1.552), 0.016, 0.040)
    front_gate = 1.0 - smoothstep(0.006, 0.052, center.y)
    breakup = 0.86 + 0.12 * organic_breakup(center, 179)
    return clamp01(max(seam * 0.78, brow * 0.58, cheek * 0.66, jaw * 0.54) * front_gate * breakup)


def head_telefrag_transition_rim(center: Vector) -> float:
    transition = head_telefrag_transition_field(center)
    if transition <= 0.0:
        return 0.0
    seam_distance = abs(center.x - head_telefrag_boundary_x(center))
    seam_lip = max(0.0, 1.0 - abs(seam_distance - 0.030) / 0.020)
    cheek_lip = diagonal_band_xz_value(center, (-0.094, 1.650), (0.102, 1.588), 0.020, 0.038)
    return clamp01(max(seam_lip * 0.76, cheek_lip * 0.58, transition * 0.36) * (0.90 + 0.08 * organic_breakup(center, 181)))


def head_cyber_intrusion_field(center: Vector) -> float:
    if not (center.y < 0.046 and 1.548 < center.z < 1.790 and abs(center.x) < 0.132):
        return 0.0
    left = 1.0 - smoothstep(0.46, 1.20, face_cyber_value(center))
    right_forehead_shard = diagonal_band_xz_value(center, (0.018, 1.742), (0.090, 1.698), 0.014, 0.040)
    right_mouth_shard = diagonal_band_xz_value(center, (-0.004, 1.628), (0.104, 1.584), 0.012, 0.034)
    chin_plate = 1.0 - smoothstep(0.54, 1.20, ellipsoid(center, (-0.020, -0.056, 1.570), (0.054, 0.034, 0.036)))
    front_gate = 1.0 - smoothstep(0.006, 0.056, center.y)
    return clamp01(max(left, right_forehead_shard * 0.70, right_mouth_shard * 0.64, chin_plate * 0.50) * front_gate)


def head_ruptured_flesh_field(center: Vector) -> float:
    if not (center.y < 0.038 and 1.548 < center.z < 1.735 and abs(center.x) < 0.132):
        return 0.0
    right = 1.0 - smoothstep(0.44, 1.18, face_muscle_value(center))
    left_cheek_gore = 1.0 - smoothstep(0.54, 1.18, ellipsoid(center, (-0.058, -0.060, 1.620), (0.050, 0.034, 0.056)))
    left_brow_gore = diagonal_band_xz_value(center, (-0.092, 1.694), (-0.010, 1.660), 0.014, 0.036)
    mouth_pull = diagonal_band_xz_value(center, (0.004, 1.602), (-0.070, 1.572), 0.014, 0.036)
    front_gate = 1.0 - smoothstep(0.008, 0.058, center.y)
    breakup = 0.90 + 0.09 * organic_breakup(center, 183)
    return clamp01(max(right, left_cheek_gore * 0.66, left_brow_gore * 0.54, mouth_pull * 0.58) * front_gate * breakup)


def head_crossing_metal_shard(center: Vector) -> bool:
    return (
        diagonal_band_xz(center, (0.020, 1.742), (0.096, 1.696), 0.010)
        or diagonal_band_xz(center, (-0.010, 1.628), (0.106, 1.582), 0.010)
        or diagonal_band_xz(center, (-0.090, 1.706), (0.012, 1.684), 0.008)
    )


def head_crossing_flesh_tear(center: Vector) -> bool:
    return (
        diagonal_band_xz(center, (-0.086, 1.642), (0.086, 1.594), 0.012)
        or diagonal_band_xz(center, (-0.070, 1.586), (0.052, 1.556), 0.010)
        or diagonal_band_xz(center, (-0.052, 1.690), (0.035, 1.650), 0.009)
    )


def head_tendon_shred(center: Vector) -> bool:
    return (
        diagonal_band_xz(center, (-0.070, 1.636), (0.092, 1.584), 0.006)
        or diagonal_band_xz(center, (0.032, 1.666), (0.096, 1.566), 0.006)
        or diagonal_band_xz(center, (-0.088, 1.694), (-0.006, 1.610), 0.005)
        or (center.y > 0.030 and diagonal_band_xz(center, (-0.042, 1.736), (0.038, 1.620), 0.006))
    )


def head_bone_splinter(center: Vector) -> bool:
    if not (center.y < -0.026 and 1.560 < center.z < 1.690 and abs(center.x) < 0.110):
        return False
    cheek = diagonal_band_xz(center, (0.050, 1.644), (0.094, 1.594), 0.007)
    jaw = diagonal_band_xz(center, (-0.010, 1.592), (0.050, 1.558), 0.006)
    brow = diagonal_band_xz(center, (-0.078, 1.686), (-0.026, 1.660), 0.006)
    return (cheek or jaw or brow) and sparse_cell(center, 4)


def head_sparse_glitch_fissure(center: Vector) -> bool:
    if not (center.y < -0.022 and 1.575 < center.z < 1.736 and abs(center.x) < 0.106):
        return False
    seam = abs(center.x - head_telefrag_boundary_x(center)) < 0.004 and sparse_cell(center, 29)
    cyber_cut = cyber_face_fissure(center) and sparse_cell(center, 11)
    brow_cut = diagonal_band_xz(center, (-0.038, 1.714), (0.035, 1.674), 0.0035) and sparse_cell(center, 31)
    return seam or cyber_cut or brow_cut


def rear_head_rupture_field(center: Vector) -> float:
    if not (center.y > 0.020 and 1.575 < center.z < 1.782 and abs(center.x) < 0.102):
        return 0.0
    wavering_x = 0.010 * math.sin((center.z - 1.585) * 38.0) + 0.006 * math.sin(center.y * 70.0)
    central = 1.0 - smoothstep(0.018, 0.060, abs(center.x - wavering_x))
    diagonal_rip = diagonal_band_xz_value(center, (-0.050, 1.740), (0.036, 1.610), 0.014, 0.040)
    side_bite = 1.0 - smoothstep(0.62, 1.22, ellipsoid(center, (-0.044, 0.050, 1.674), (0.044, 0.032, 0.072)))
    back_gate = smoothstep(0.020, 0.060, center.y)
    return clamp01(max(central * 0.64, diagonal_rip * 0.72, side_bite * 0.50) * back_gate * (0.88 + 0.10 * organic_breakup(center, 187)))


def rear_head_rupture_rim(center: Vector) -> float:
    field = rear_head_rupture_field(center)
    if field <= 0.0:
        return 0.0
    wavering_x = 0.010 * math.sin((center.z - 1.585) * 38.0) + 0.006 * math.sin(center.y * 70.0)
    lip = max(0.0, 1.0 - abs(abs(center.x - wavering_x) - 0.040) / 0.022)
    diagonal_lip = diagonal_band_xz_value(center, (-0.060, 1.750), (0.045, 1.602), 0.018, 0.030)
    return clamp01(max(lip * 0.72, diagonal_lip * 0.58, field * 0.28))


def cranial_cyber_shell(center: Vector) -> bool:
    if center.z < 1.650 or center.z > 1.814 or center.y > 0.046 or center.x > 0.034:
        return False
    value = ellipsoid(center, (-0.040, -0.012, 1.732), (0.078, 0.060, 0.092))
    return ragged_value(value, center, 0.0, 0.72, 0.040, 28)


def cranial_cyber_shell_feather(center: Vector) -> bool:
    if center.z < 1.632 or center.z > 1.820 or center.y > 0.058 or center.x > 0.052:
        return False
    value = ellipsoid(center, (-0.040, -0.012, 1.732), (0.086, 0.066, 0.100))
    return ragged_value(value, center, 0.68, 1.18, 0.050, 39)


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


def cranial_flayed_scalp_field(center: Vector) -> float:
    if not (1.642 < center.z < 1.818 and -0.074 < center.y < 0.078 and abs(center.x) < 0.132):
        return 0.0
    crown_bite = 1.0 - smoothstep(
        0.38,
        1.22,
        ellipsoid(center, (0.006, -0.010, 1.758), (0.106, 0.070, 0.064)),
    )
    left_peel = diagonal_band_xz_value(center, (-0.090, 1.806), (0.048, 1.692), 0.027, 0.052)
    rear_peel = diagonal_band_xz_value(center, (-0.052, 1.782), (0.036, 1.640), 0.024, 0.050) * smoothstep(0.000, 0.058, center.y)
    right_flesh = diagonal_band_xz_value(center, (0.084, 1.795), (-0.014, 1.678), 0.024, 0.048)
    brow_drop = diagonal_band_xz_value(center, (-0.064, 1.742), (0.070, 1.704), 0.020, 0.044) * (1.0 - smoothstep(-0.010, 0.040, center.y))
    cap_gate = 1.0 - smoothstep(0.062, 0.092, abs(center.y))
    breakup = 0.84 + 0.14 * organic_breakup(center, 193)
    return clamp01(max(crown_bite * 0.88, left_peel * 0.82, rear_peel * 0.74, right_flesh * 0.68, brow_drop * 0.62) * cap_gate * breakup)


def cranial_flayed_scalp_rim(center: Vector) -> float:
    field = cranial_flayed_scalp_field(center)
    if field <= 0.0:
        return 0.0
    crown = ellipsoid(center, (0.006, -0.010, 1.758), (0.108, 0.072, 0.066))
    shell_lip = max(0.0, 1.0 - abs(crown - 0.86) / 0.30)
    tear_lip = max(
        diagonal_band_xz_value(center, (-0.088, 1.806), (0.050, 1.704), 0.014, 0.036),
        diagonal_band_xz_value(center, (0.076, 1.790), (-0.012, 1.688), 0.012, 0.034),
    )
    return clamp01(max(shell_lip * 0.68, tear_lip * 0.82, field * 0.28) * (0.88 + 0.10 * organic_breakup(center, 195)))


def cranial_scalp_tendon(center: Vector) -> bool:
    return (
        diagonal_band_xz(center, (-0.076, 1.792), (0.042, 1.708), 0.006)
        or diagonal_band_xz(center, (0.066, 1.782), (-0.006, 1.696), 0.005)
        or (center.y > 0.018 and diagonal_band_xz(center, (-0.038, 1.754), (0.024, 1.664), 0.006))
    ) and sparse_cell(center, 3)


def cranial_scalp_bone(center: Vector) -> bool:
    if not (center.y < 0.052 and 1.668 < center.z < 1.800 and -0.086 < center.x < 0.086):
        return False
    sagittal = abs(center.x - 0.012 * math.sin(center.z * 47.0)) < 0.008
    cross = diagonal_band_xz(center, (-0.052, 1.762), (0.050, 1.724), 0.006)
    return (sagittal or cross) and sparse_cell(center, 4)


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
        abs(center.x + 0.047 + 0.21 * (center.z - 1.690)) < 0.003
        or abs(center.x - 0.012 * math.sin(center.z * 51.0)) < 0.003 and center.y > 0.026
    ) and sparse_cell(center, 41)


def cranial_embedded_fragment(center: Vector) -> bool:
    if not (center.y < 0.050 and 1.694 < center.z < 1.812 and abs(center.x) < 0.112):
        return False
    rake_a = diagonal_band_xz(center, (-0.080, 1.806), (0.046, 1.712), 0.009)
    rake_b = diagonal_band_xz(center, (0.070, 1.790), (-0.024, 1.704), 0.008)
    brow_crush = diagonal_band_xz(center, (-0.070, 1.724), (0.070, 1.700), 0.010)
    sagittal_chip = abs(center.x - 0.010 * math.sin(center.z * 43.0)) < 0.006 and 1.720 < center.z
    return (rake_a or rake_b or brow_crush or sagittal_chip) and sparse_cell(center, 3)


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


def uncanny_left_eye_socket_field(center: Vector) -> float:
    if not (center.y < -0.024 and -0.090 < center.x < -0.006 and 1.638 < center.z < 1.706):
        return 0.0
    socket = 1.0 - smoothstep(
        0.38,
        1.18,
        ellipsoid(center, (-0.047, -0.064, 1.674), (0.052, 0.026, 0.034)),
    )
    horizontal_cut = diagonal_band_xz_value(center, (-0.088, 1.680), (-0.010, 1.664), 0.012, 0.036)
    upper_lid_crush = diagonal_band_xz_value(center, (-0.082, 1.698), (-0.016, 1.678), 0.010, 0.030)
    return clamp01(max(socket * 0.90, horizontal_cut * 0.72, upper_lid_crush * 0.62))


def uncanny_left_eye_socket_rim(center: Vector) -> float:
    field = uncanny_left_eye_socket_field(center)
    if field <= 0.0:
        return 0.0
    shell = ellipsoid(center, (-0.047, -0.064, 1.674), (0.056, 0.028, 0.038))
    rim = max(0.0, 1.0 - abs(shell - 0.92) / 0.30)
    lower_cut = diagonal_band_xz_value(center, (-0.082, 1.656), (-0.018, 1.646), 0.007, 0.026)
    return clamp01(max(rim * 0.76, lower_cut * 0.64, field * 0.24))


def uncanny_right_eye_wound_field(center: Vector) -> float:
    if not (center.y < -0.024 and 0.004 < center.x < 0.096 and 1.632 < center.z < 1.700):
        return 0.0
    socket = 1.0 - smoothstep(
        0.44,
        1.22,
        ellipsoid(center, (0.050, -0.064, 1.664), (0.054, 0.027, 0.036)),
    )
    lower_blood = diagonal_band_xz_value(center, (0.012, 1.656), (0.090, 1.642), 0.011, 0.034)
    inner_tear = 1.0 - smoothstep(0.38, 1.06, ellipsoid(center, (0.026, -0.067, 1.666), (0.018, 0.015, 0.020)))
    return clamp01(max(socket * 0.74, lower_blood * 0.72, inner_tear * 0.66))


def uncanny_right_eye_wound_rim(center: Vector) -> float:
    field = uncanny_right_eye_wound_field(center)
    if field <= 0.0:
        return 0.0
    shell = ellipsoid(center, (0.050, -0.064, 1.664), (0.060, 0.030, 0.042))
    rim = max(0.0, 1.0 - abs(shell - 0.94) / 0.32)
    brow_pull = diagonal_band_xz_value(center, (0.016, 1.686), (0.092, 1.670), 0.008, 0.028)
    return clamp01(max(rim * 0.70, brow_pull * 0.58, field * 0.22))


def readable_mouth_cavity_field(center: Vector) -> float:
    if not (center.y < -0.030 and -0.086 < center.x < 0.104 and 1.566 < center.z < 1.630):
        return 0.0
    horizontal_gash = 1.0 - smoothstep(
        0.42,
        1.18,
        ellipsoid(center, (0.014, -0.067, 1.598), (0.090, 0.021, 0.020)),
    )
    left_machine_pull = diagonal_band_xz_value(center, (-0.080, 1.616), (-0.012, 1.594), 0.012, 0.034)
    right_flesh_pull = diagonal_band_xz_value(center, (0.010, 1.600), (0.096, 1.584), 0.014, 0.036)
    lower_drop = diagonal_band_xz_value(center, (-0.046, 1.586), (0.070, 1.570), 0.010, 0.032)
    breakup = 0.88 + 0.10 * organic_breakup(center, 233)
    return clamp01(max(horizontal_gash * 0.92, left_machine_pull * 0.60, right_flesh_pull * 0.72, lower_drop * 0.56) * breakup)


def readable_mouth_rim_field(center: Vector) -> float:
    cavity = readable_mouth_cavity_field(center)
    if cavity <= 0.0:
        return 0.0
    shell = ellipsoid(center, (0.014, -0.067, 1.598), (0.094, 0.024, 0.024))
    rim = max(0.0, 1.0 - abs(shell - 0.92) / 0.30)
    upper_lip = diagonal_band_xz_value(center, (-0.082, 1.620), (0.096, 1.606), 0.007, 0.026)
    lower_lip = diagonal_band_xz_value(center, (-0.070, 1.586), (0.088, 1.566), 0.007, 0.028)
    return clamp01(max(rim * 0.74, upper_lip * 0.66, lower_lip * 0.58, cavity * 0.20))


def readable_mouth_tendon_strand(center: Vector) -> bool:
    if readable_mouth_rim_field(center) <= 0.18:
        return False
    return (
        diagonal_band_xz(center, (-0.074, 1.616), (0.084, 1.584), 0.005)
        or diagonal_band_xz(center, (-0.026, 1.626), (0.052, 1.570), 0.005)
        or diagonal_band_xz(center, (0.012, 1.610), (0.096, 1.592), 0.0045)
    )


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
    return (eye_spark and sparse_cell(center, 7)) or (jaw_spark and sparse_cell(center, 9))


def cheek_blood_crack(center: Vector) -> bool:
    if not (center.y < -0.026 and 0.014 < center.x < 0.105 and 1.570 < center.z < 1.660):
        return False
    return abs((center.x - 0.054) - 0.30 * (center.z - 1.610)) < 0.010


def rear_head_fissure(center: Vector) -> bool:
    if not (center.y > 0.032 and 1.590 < center.z < 1.775):
        return False
    wavering_x = 0.014 * math.sin((center.z - 1.58) * 42.0)
    central_spark = abs(center.x - wavering_x) < 0.0035 and sparse_cell(center, 29)
    secondary_spark = abs(center.x + 0.034) < 0.0035 and sparse_cell(center, 37)
    return central_spark or secondary_spark


def rear_fissure(center: Vector) -> bool:
    wavering_x = rear_spine_wave(center)
    interrupted_core = abs(center.x - wavering_x) < 0.004 and sparse_cell(center, 19)
    secondary_sparks = abs(center.x - wavering_x) < 0.010 and sparse_cell(center, 29)
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


def neck_collar_fusion_field(center: Vector) -> float:
    if not (center.y < 0.026 and 1.452 < center.z < 1.538 and abs(center.x) < 0.152):
        return 0.0
    collar = 1.0 - smoothstep(
        0.66,
        1.38,
        ellipsoid(center, (0.006, -0.034, 1.493), (0.136, 0.058, 0.048)),
    )
    lower_lip = diagonal_band_xz_value(center, (-0.118, 1.488), (0.110, 1.466), 0.020, 0.044)
    throat_drop = diagonal_band_xz_value(center, (-0.004, 1.526), (0.026, 1.482), 0.018, 0.040)
    left_metal = diagonal_band_xz_value(center, (-0.112, 1.516), (-0.020, 1.488), 0.014, 0.034)
    right_sinew = diagonal_band_xz_value(center, (0.110, 1.512), (0.020, 1.486), 0.014, 0.034)
    side_falloff = 1.0 - smoothstep(0.128, 0.156, abs(center.x))
    front_gate = 1.0 - smoothstep(0.018, 0.060, center.y)
    breakup = 0.90 + 0.08 * organic_breakup(center, 151)
    return clamp01(
        max(collar * 0.74, lower_lip * 0.68, throat_drop * 0.72, left_metal * 0.58, right_sinew * 0.56)
        * side_falloff
        * front_gate
        * breakup
    )


def neck_collar_fusion_rim(center: Vector) -> float:
    if neck_collar_fusion_field(center) <= 0.0:
        return 0.0
    shell = ellipsoid(center, (0.006, -0.034, 1.493), (0.140, 0.060, 0.050))
    lip = max(0.0, 1.0 - abs(shell - 0.96) / 0.32)
    lower_lip = diagonal_band_xz_value(center, (-0.122, 1.488), (0.114, 1.466), 0.014, 0.036)
    return clamp01(max(lip * 0.74, lower_lip * 0.82) * (0.88 + 0.10 * organic_breakup(center, 153)))


def neck_collar_fusion_strand(center: Vector) -> bool:
    return (
        diagonal_band_xz(center, (-0.080, 1.516), (0.020, 1.486), 0.006)
        or diagonal_band_xz(center, (0.086, 1.510), (-0.006, 1.482), 0.006)
        or diagonal_band_xz(center, (0.000, 1.526), (0.036, 1.482), 0.006)
    )


def neck_collar_green_spark(center: Vector) -> bool:
    return (
        center.y < -0.018
        and 1.482 < center.z < 1.522
        and abs(center.x - 0.004) < 0.010
        and sparse_cell(center, 13)
    )


def neck_chest_telefrag_transition_field(center: Vector) -> float:
    if not (center.y < 0.018 and 1.458 < center.z < 1.540 and abs(center.x) < 0.142):
        return 0.0
    collar = 1.0 - smoothstep(
        0.62,
        1.34,
        ellipsoid(center, (0.012, -0.026, 1.500), (0.128, 0.050, 0.052)),
    )
    center_drop = diagonal_band_xz_value(center, (-0.006, 1.530), (0.026, 1.488), 0.016, 0.038)
    left_metal_rip = diagonal_band_xz_value(center, (-0.116, 1.520), (-0.012, 1.496), 0.016, 0.034)
    right_sinew_rip = diagonal_band_xz_value(center, (0.112, 1.518), (0.018, 1.492), 0.014, 0.032)
    lower_scar_lip = diagonal_band_xz_value(center, (-0.100, 1.486), (0.106, 1.466), 0.018, 0.040)
    breakup = 0.86 + 0.12 * organic_breakup(center, 141)
    return clamp01(
        max(collar * 0.68, center_drop * 0.72, left_metal_rip * 0.56, right_sinew_rip * 0.54, lower_scar_lip * 0.62)
        * breakup
    )


def neck_chest_tendon_strand(center: Vector) -> bool:
    return (
        diagonal_band_xz(center, (-0.004, 1.532), (0.036, 1.492), 0.008)
        or diagonal_band_xz(center, (0.074, 1.524), (0.008, 1.494), 0.007)
        or diagonal_band_xz(center, (-0.068, 1.522), (0.000, 1.496), 0.007)
    )


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
        left_socket_field = uncanny_left_eye_socket_field(local)
        if left_socket_field > 0.02:
            rim = uncanny_left_eye_socket_rim(local)
            local.y -= 0.0065 * left_socket_field
            local.y += 0.0028 * rim
            local.z += 0.0012 * rim * math.sin(local.x * 180.0)
            local.x -= 0.0016 * left_socket_field
        right_eye_field = uncanny_right_eye_wound_field(local)
        if right_eye_field > 0.02:
            rim = uncanny_right_eye_wound_rim(local)
            lid_sag = max(0.0, min(1.0, (1.674 - local.z) / 0.046))
            local.y -= 0.0024 * right_eye_field
            local.y += 0.0032 * rim
            local.z -= 0.0024 * lid_sag * right_eye_field
            local.x += 0.0011 * math.sin(local.z * 96.0) * right_eye_field
        mouth_field = readable_mouth_cavity_field(local)
        if mouth_field > 0.02:
            rim = readable_mouth_rim_field(local)
            local.y -= 0.0060 * mouth_field
            local.y += 0.0032 * rim
            local.z -= 0.0026 * mouth_field * smoothstep(1.585, 1.610, local.z)
            local.x += 0.0014 * math.sin(local.z * 118.0 + local.x * 57.0) * rim
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


def sculpt_neck_collar_fusion(head_obj: bpy.types.Object, carrier_mesh: bpy.types.Object) -> None:
    head_matrix = head_obj.matrix_world.copy()
    head_inv_basis = head_matrix.inverted().to_3x3()
    for vertex in head_obj.data.vertices:
        world = head_matrix @ vertex.co
        field = neck_collar_fusion_field(world)
        if field <= 0.03:
            continue
        lateral = smoothstep(0.030, 0.142, abs(world.x))
        lower_floor = 1.470 - 0.014 * lateral + 0.0014 * math.sin(world.x * 76.0 + world.y * 23.0)
        delta = Vector((0.0, 0.0, 0.0))
        if world.z < lower_floor:
            delta.z += (lower_floor - world.z) * clamp01(field * 1.35)
        if world.y < -0.010:
            delta.y += 0.0028 * field * (1.0 - lateral * 0.35)
        if neck_collar_fusion_rim(world) > 0.34:
            delta.y -= 0.0016 * neck_collar_fusion_rim(world)
        if delta.length_squared > 0.0:
            vertex.co += head_inv_basis @ delta
    head_obj.data.update()

    carrier_matrix = carrier_mesh.matrix_world.copy()
    carrier_inv_basis = carrier_matrix.inverted().to_3x3()
    for vertex in carrier_mesh.data.vertices:
        world = carrier_matrix @ vertex.co
        field = neck_collar_fusion_field(world)
        if field <= 0.04:
            continue
        rim = neck_collar_fusion_rim(world)
        delta = Vector((0.0, -0.0018 * field + 0.0012 * rim, 0.0008 * rim - 0.0016 * field))
        if abs(world.x) < 0.030:
            delta.z -= 0.0010 * field
        vertex.co += carrier_inv_basis @ delta
    carrier_mesh.data.update()


def sculpt_body_glitch_offsets(carrier_mesh: bpy.types.Object) -> None:
    for vertex in carrier_mesh.data.vertices:
        local = vertex.co
        if local.z > 0.965 and abs(local.x) < 0.070 and local.y > 0.040:
            local.x += 0.0040 * math.sin(local.z * 25.0)
            local.y += 0.0045
        telefrag_value = ellipsoid(local, (0.023, -0.064, 1.402), (0.088, 0.060, 0.110))
        if local.y < -0.014 and telefrag_value < 1.02:
            recession = max(0.0, 1.0 - telefrag_value)
            local.y -= 0.0125 * recession
            local.x += 0.0025 * math.sin(local.z * 69.0 + local.x * 37.0) * recession
        if local.y < -0.014 and 0.72 < telefrag_value < 1.20:
            rim = 1.0 - min(abs(telefrag_value - 0.94) / 0.26, 1.0)
            local.y += 0.0064 * rim
        if local.y < -0.016 and 1.285 < local.z < 1.505 and 0.070 < abs(local.x) < 0.158:
            rib_relief = 1.0 - smoothstep(0.070, 0.158, abs(abs(local.x) - 0.112))
            local.y += 0.0048 * rib_relief
            local.z += 0.0022 * math.sin(local.z * 76.0 + abs(local.x) * 33.0) * rib_relief
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
        rear_field = rear_torso_rupture_field(local)
        side_field = side_torso_wrap_field(local)
        if rear_field > 0.04 or side_field > 0.05:
            rear_rim = rear_torso_rupture_rim(local)
            side_rim = side_torso_wrap_rim(local)
            field = max(rear_field, side_field * 0.86)
            rim = max(rear_rim, side_rim * 0.74)
            side_sign = -1.0 if local.x < 0.0 else 1.0
            side_gate = smoothstep(0.132, 0.190, abs(local.x)) * (1.0 - smoothstep(0.088, 0.150, local.y))
            local.y -= 0.0068 * rear_field
            local.y += 0.0050 * rim
            local.x += side_sign * 0.0038 * side_gate * rim
            local.x -= side_sign * 0.0044 * side_gate * field
            local.z += 0.0026 * rim * math.sin(local.x * 88.0 + local.z * 39.0)
            if rear_torso_bone_hint(local):
                local.y += 0.0024
        if local.y > 0.020 and 1.130 < local.z < 1.505 and 0.075 < abs(local.x) < 0.165:
            local.y += 0.0028
        if local.x < -0.130 and 0.780 < local.z < 1.455:
            local.x -= 0.0045 * math.sin(local.z * 42.0)
            local.y += 0.0025 * math.cos(local.z * 31.0)
        if local.x > 0.142 and 1.045 < local.z < 1.420:
            local.x += 0.0025 * math.sin(local.z * 39.0)
            local.y += 0.0018 * math.cos(local.z * 27.0)
        lower_transition = lower_body_transition_field(local)
        if lower_transition > 0.04:
            rim = lower_body_transition_rim(local)
            local.y += 0.0024 * rim - 0.0018 * lower_transition
            local.x += 0.0018 * math.sin(local.z * 66.0 + local.y * 29.0) * lower_transition
            local.z += 0.0012 * rim * math.sin(local.x * 112.0)
        limb_scar = limb_transition_scar_field(local)
        if limb_scar > 0.05:
            rim = limb_transition_scar_rim(local)
            side = -1.0 if local.x < 0.0 else 1.0
            local.x += side * (0.0015 * rim - 0.0010 * limb_scar)
            local.y += 0.0014 * rim - 0.0009 * limb_scar
            local.z += 0.0010 * math.sin(local.x * 94.0 + local.z * 58.0) * limb_scar
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
            poly.material_index = slots["eye"] if radial > 0.014 else slots["optic"]
        if side_key == "right" and front_surface and radial < 0.032:
            poly.material_index = slots["eye"]
            if rel.z < -0.002 and sparse_cell(center, 4):
                poly.material_index = slots["clot"]
        if front_surface and radial < 0.016:
            poly.material_index = slots["optic"]
        if side_key == "left" and front_surface and abs((rel.x - iris_offset_x) + 0.55 * (rel.z - iris_offset_z)) < 0.003 and 0.020 < radial < 0.038 and sparse_cell(center, 11):
            poly.material_index = slots["cyber"] if radial > 0.027 else slots["optic"]
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
        mats["torso_blend"],
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
        if index in {0, 4, 8}:
            append_box_geometry(vertices, faces, face_materials, center + Vector((0.0, 0.014, 0.0)), (0.0035, 0.0035, 0.009), slot("green_glow"))
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
        Vector((0.003, -0.090, 1.442)),
        Vector((0.011, -0.091, 1.390)),
        0.0025,
        0.0035,
        slot("green_glow"),
    )
    append_front_ring_geometry(
        vertices,
        faces,
        face_materials,
        Vector((0.023, -0.087, 1.402)),
        (0.052, 0.082),
        (0.028, 0.046),
        lambda x, theta, index: slot("torso_blend" if index % 4 else "metal_edge")
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
    for index, z in enumerate([1.476, 1.442, 1.406, 1.370, 1.336]):
        left_end = Vector((-0.108 - 0.004 * index, -0.080, z + 0.018 - 0.004 * index))
        right_end = Vector((0.108 + 0.003 * index, -0.081, z + 0.014 - 0.004 * index))
        append_bar_geometry(
            vertices,
            faces,
            face_materials,
            Vector((0.000, -0.086, z)),
            left_end,
            0.0042 if index < 3 else 0.0036,
            0.0048 if index < 3 else 0.0040,
            slot("torso_blend" if index % 2 else "cyber_metal"),
        )
        append_bar_geometry(
            vertices,
            faces,
            face_materials,
            Vector((0.028, -0.087, z - 0.006)),
            right_end,
            0.0036,
            0.0042,
            slot("muscle_gloss" if index % 2 else "tendon"),
        )
    for index, (x, z, mat_key) in enumerate(
        [
            (-0.030, 1.462, "bone"),
            (0.020, 1.430, "tendon"),
            (-0.012, 1.394, "bone"),
            (0.038, 1.358, "muscle_gloss"),
        ]
    ):
        append_box_geometry(
            vertices,
            faces,
            face_materials,
            Vector((x, -0.087, z)),
            (0.014 - index * 0.0014, 0.007, 0.030),
            slot(mat_key),
        )
    for index, (start, end, mat_key, radius) in enumerate(
        [
            (Vector((-0.018, -0.082, 1.474)), Vector((0.046, -0.079, 1.386)), "clot", 0.0027),
            (Vector((0.010, -0.083, 1.466)), Vector((-0.052, -0.079, 1.398)), "clot", 0.0026),
            (Vector((0.044, -0.082, 1.446)), Vector((0.076, -0.078, 1.360)), "muscle_gloss", 0.0030),
            (Vector((-0.030, -0.081, 1.426)), Vector((-0.082, -0.077, 1.364)), "torso_blend", 0.0034),
        ]
    ):
        append_bar_geometry(
            vertices,
            faces,
            face_materials,
            start,
            end,
            radius,
            radius * 1.18,
            slot(mat_key),
        )
        if index == 1:
            append_bar_geometry(
                vertices,
                faces,
                face_materials,
                start + Vector((0.007, -0.002, -0.010)),
                end + Vector((0.004, -0.002, -0.012)),
                0.0014,
                0.0017,
                slot("clot"),
            )
    append_bar_geometry(
        vertices,
        faces,
        face_materials,
        Vector((0.019, -0.086, 1.454)),
        Vector((0.026, -0.086, 1.390)),
        0.0022,
        0.0025,
        slot("green_glow"),
    )
    for index, z in enumerate([1.442, 1.405, 1.368]):
        append_bar_geometry(
            vertices,
            faces,
            face_materials,
            Vector((0.002, -0.083, z)),
            Vector((-0.078 - index * 0.003, -0.077, z + 0.016 - index * 0.006)),
            0.0038,
            0.0034,
            slot("torso_blend" if index != 1 else "metal_edge"),
        )
        append_bar_geometry(
            vertices,
            faces,
            face_materials,
            Vector((0.034, -0.083, z - 0.010)),
            Vector((0.092 + index * 0.002, -0.077, z + 0.014 - index * 0.006)),
            0.0035,
            0.0035,
            slot("tendon" if index != 2 else "muscle_gloss"),
        )

    for index in range(3):
        z = 1.135 + index * 0.105
        append_bar_geometry(
            vertices,
            faces,
            face_materials,
            Vector((-0.154, -0.010, z)),
            Vector((-0.190, 0.026, z + 0.054)),
            0.0048,
            0.0062,
            slot("cyber_metal" if index != 1 else "copper"),
        )
        append_bar_geometry(
            vertices,
            faces,
            face_materials,
            Vector((0.150, -0.012, z + 0.030)),
            Vector((0.176, 0.024, z + 0.078)),
            0.0038,
            0.0052,
            slot("muscle_gloss"),
        )

    for side in [-1.0, 1.0]:
        side_key = "cyber_metal" if side < 0.0 else "clot"
        for index, z in enumerate([1.215, 1.302, 1.388, 1.474]):
            append_bar_geometry(
                vertices,
                faces,
                face_materials,
                Vector((side * 0.120, -0.016, z)),
                Vector((side * (0.150 + 0.004 * math.sin(index)), 0.012, z + 0.024)),
                0.0024 if side < 0.0 else 0.0020,
                0.0032 if side < 0.0 else 0.0028,
                slot("torso_blend" if index % 2 else ("cyber_metal" if side < 0.0 else "muscle_gloss")),
            )
        append_bar_geometry(
            vertices,
            faces,
            face_materials,
            Vector((side * 0.070, 0.084, 1.500)),
            Vector((side * 0.128, 0.096, 1.430)),
            0.0056,
            0.0076,
            slot("metal_edge" if side < 0.0 else "clot"),
        )
        append_bar_geometry(
            vertices,
            faces,
            face_materials,
            Vector((side * 0.032, 0.086, 1.450)),
            Vector((side * 0.098, 0.098, 1.358)),
            0.0036,
            0.0048,
            slot("cyber_metal" if side < 0.0 else "clot"),
        )

    for side in [-1.0, 1.0]:
        for index, z in enumerate([1.512, 1.455, 1.396, 1.334, 1.272]):
            append_bar_geometry(
                vertices,
                faces,
                face_materials,
                Vector((side * 0.024, 0.128, z + 0.006)),
                Vector((side * (0.132 + 0.012 * math.sin(index * 1.4)), 0.154, z - 0.050)),
                0.0110 if side < 0.0 else 0.0084,
                0.0140 if side < 0.0 else 0.0104,
                slot("metal_edge" if side < 0.0 else ("bone" if index % 2 else "tendon")),
            )
        append_box_geometry(
            vertices,
            faces,
            face_materials,
            Vector((side * 0.080, 0.152, 1.405)),
            (0.046, 0.026, 0.112),
            slot("cyber_metal" if side < 0.0 else "clot"),
        )
    for index, z in enumerate([1.555, 1.495, 1.435, 1.375, 1.315]):
        append_box_geometry(
            vertices,
            faces,
            face_materials,
            Vector((rear_spine_wave(Vector((0.0, 0.096, z))), 0.158, z)),
            (0.068 + 0.010 * (index % 2), 0.032, 0.040),
            slot("metal_edge" if index in {0, 3} else "cyber_metal"),
        )
        if index in {1, 4}:
            append_bar_geometry(
                vertices,
                faces,
                face_materials,
                Vector((-0.014, 0.176, z + 0.016)),
                Vector((0.024, 0.178, z - 0.034)),
                0.0030,
                0.0038,
                slot("green_glow"),
            )
    for index, z in enumerate([1.505, 1.452, 1.398]):
        append_bar_geometry(
            vertices,
            faces,
            face_materials,
            Vector((-0.104, 0.166, z)),
            Vector((0.088, 0.170, z - 0.046)),
            0.0066,
            0.0090,
            slot("metal_edge" if index != 1 else "copper"),
        )

    append_front_ring_geometry(
        vertices,
        faces,
        face_materials,
        Vector((0.018, 0.178, 1.410)),
        (0.124, 0.164),
        (0.056, 0.082),
        lambda x, theta, index: (
            slot("metal_edge")
            if x < -0.018 and index % 3 == 0
            else slot("tendon")
            if x > 0.042 and index % 4 == 0
            else slot("torso_blend")
        ),
        28,
        71,
    )
    append_front_disc_geometry(
        vertices,
        faces,
        face_materials,
        Vector((0.044, 0.180, 1.374)),
        (0.050, 0.094),
        slot("clot"),
        22,
        72,
    )
    append_front_disc_geometry(
        vertices,
        faces,
        face_materials,
        Vector((-0.056, 0.181, 1.448)),
        (0.040, 0.082),
        slot("cyber_metal"),
        20,
        73,
    )
    for index, (x, z, mat_key) in enumerate(
        [
            (-0.018, 1.506, "bone"),
            (0.024, 1.462, "tendon"),
            (-0.006, 1.358, "metal_edge"),
        ]
    ):
        append_box_geometry(
            vertices,
            faces,
            face_materials,
            Vector((x, 0.184, z)),
            (0.024 - index * 0.002, 0.010, 0.062),
            slot(mat_key),
        )

    vertices = soften_front_embedded_structure_vertices(vertices)
    vertices = soften_rear_embedded_structure_vertices(vertices)

    face_clearance_z = 1.528
    vertices = [
        (x, y, min(z, face_clearance_z - 0.003 * abs(math.sin(x * 91.0 + y * 37.0))))
        for x, y, z in vertices
    ]

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


def soften_front_embedded_structure_vertices(vertices: list[tuple[float, float, float]]) -> list[tuple[float, float, float]]:
    softened: list[tuple[float, float, float]] = []
    for x, y, z in vertices:
        if y < -0.078 and 1.318 < z < 1.535 and abs(x) < 0.152:
            center_weight = 1.0 - smoothstep(0.050, 0.152, abs(x))
            vertical_weight = 1.0 - smoothstep(0.0, 0.135, abs(z - 1.420))
            embed = clamp01(max(center_weight * 0.70, vertical_weight * 0.54))
            y += 0.010 * embed + 0.0025 * math.sin(x * 64.0 + z * 31.0)
            x += 0.0012 * embed * math.sin(z * 83.0)
            z += 0.0010 * embed * math.sin(x * 97.0 + z * 29.0)
        softened.append((x, y, z))
    return softened


def soften_rear_embedded_structure_vertices(vertices: list[tuple[float, float, float]]) -> list[tuple[float, float, float]]:
    softened: list[tuple[float, float, float]] = []
    for x, y, z in vertices:
        if y > 0.118 and 1.205 < z < 1.540 and abs(x) < 0.178:
            center_weight = 1.0 - smoothstep(0.040, 0.155, abs(x - rear_spine_wave(Vector((x, y, z)))))
            vertical_weight = 1.0 - smoothstep(0.0, 0.170, abs(z - 1.410))
            embed = clamp01(max(center_weight * 0.62, vertical_weight * 0.54))
            y -= 0.026 * embed
            y = min(y, 0.132 + 0.012 * (1.0 - embed) + 0.003 * math.sin(x * 71.0 + z * 29.0))
            x += 0.0018 * embed * math.sin(z * 77.0 + y * 21.0)
            z += 0.0014 * embed * math.sin(x * 94.0 + z * 33.0)
        softened.append((x, y, z))
    return softened


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


def apply_mask_projection_uvs(objects: list[bpy.types.Object]) -> None:
    for obj in objects:
        if obj is None or obj.type != "MESH" or not obj.data.vertices:
            continue
        ensure_mask_projection_uv(obj)


def ensure_mask_projection_uv(obj: bpy.types.Object) -> None:
    mesh = obj.data
    world_points = [obj.matrix_world @ vertex.co for vertex in mesh.vertices]
    min_x = min(point.x for point in world_points)
    max_x = max(point.x for point in world_points)
    min_z = min(point.z for point in world_points)
    max_z = max(point.z for point in world_points)
    span_x = max(max_x - min_x, 0.001)
    span_z = max(max_z - min_z, 0.001)

    uv_layer = mesh.uv_layers.get(MASK_UV_NAME)
    if uv_layer is None:
        uv_layer = mesh.uv_layers.new(name=MASK_UV_NAME)
    mesh.uv_layers.active = uv_layer
    if hasattr(uv_layer, "active_render"):
        uv_layer.active_render = True

    for poly in mesh.polygons:
        for loop_index in poly.loop_indices:
            vertex = mesh.vertices[mesh.loops[loop_index].vertex_index]
            world = obj.matrix_world @ vertex.co
            horizontal = (world.x - min_x) / span_x
            vertical = (world.z - min_z) / span_z
            depth = 0.5 + 0.5 * math.sin(world.y * 19.0 + world.z * 3.5)
            u = horizontal * 0.72 + vertical * 0.10 + 0.075 * math.sin(world.z * 17.0) + depth * 0.035
            v = vertical * 0.78 + horizontal * 0.08 + 0.055 * math.sin(world.x * 23.0 + world.y * 11.0)
            uv_layer.data[loop_index].uv = (u % 1.0, v % 1.0)
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
    paths.extend(render_diagnostic_set(dist_dir, camera))
    mask_preview = dist_dir / f"{MASK_ATLAS_NAME}_preview.png"
    if mask_preview.exists():
        paths.append(str(mask_preview))
    torso_detail_preview = dist_dir / f"{TORSO_DETAIL_MAP_NAME}_preview.png"
    if torso_detail_preview.exists():
        paths.append(str(torso_detail_preview))
    make_contact_sheet(paths, dist_dir / f"{VARIANT_ID}_contact_sheet.png")
    return [path_relative_to_project(path) for path in paths]


def render_diagnostic_set(dist_dir: Path, camera: bpy.types.Object) -> list[str]:
    head_obj = bpy.data.objects.get("experiment_reallusion_integrated_head")
    carrier_obj = find_carrier_body_mesh()
    paths = []
    if head_obj is not None:
        paths.extend(
            [
                render_head_wireframe_diagnostic(dist_dir, camera, head_obj),
                render_head_vertex_mask_diagnostic(dist_dir, camera, head_obj),
            ]
        )
    if carrier_obj is not None:
        paths.append(render_torso_vertex_mask_diagnostic(dist_dir, camera, carrier_obj))
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


def render_torso_vertex_mask_diagnostic(
    dist_dir: Path,
    camera: bpy.types.Object,
    carrier_obj: bpy.types.Object,
) -> Path:
    output_path = dist_dir / f"{VARIANT_ID}_torso_vertex_mask.png"
    mask_mat = make_body_torso_mask_debug_material()
    mask_obj = duplicate_mesh_for_diagnostic(carrier_obj, "EX_preview_torso_vertex_mask", mask_mat)
    try:
        render_torso_diagnostic_camera(camera, carrier_obj)
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


def render_torso_diagnostic_camera(camera: bpy.types.Object, carrier_obj: bpy.types.Object) -> None:
    bounds = object_bounds(carrier_obj)
    center = Vector(bounds["center"])
    distance = 2.2
    camera.location = Vector((center.x + 0.06, center.y - distance, 1.405))
    look_at(camera, Vector((center.x + 0.010, center.y - 0.010, 1.405)))
    camera.data.ortho_scale = 0.64


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


def make_body_torso_mask_debug_material() -> bpy.types.Material:
    mat = bpy.data.materials.new("EX_preview_body_torso_mask_debug")
    mat.use_nodes = True
    mat.diffuse_color = (0.75, 0.20, 0.70, 1.0)
    nodes = mat.node_tree.nodes
    nodes.clear()
    output = nodes.new(type="ShaderNodeOutputMaterial")
    attribute = nodes.new(type="ShaderNodeAttribute")
    attribute.attribute_name = BODY_TORSO_MASK_NAME
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


def find_carrier_body_mesh() -> bpy.types.Object | None:
    excluded_names = {
        "experiment_reallusion_integrated_head",
        "experiment_reallusion_eyes",
        "experiment_reallusion_teeth",
        "experiment_reallusion_tongue",
        "experiment_integrated_torso_spine_cage",
    }
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj.name.startswith("EX_preview_") or obj.name in excluded_names:
            continue
        return obj
    return None


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
    torso_detail_metadata: dict,
) -> None:
    report_path = dist_glb.parent / f"{VARIANT_ID}_report.json"
    glb_stats = read_glb_stats(dist_glb)
    validation = validate_experiment_asset(glb_stats, removed_faces, transplant_group, mask_metadata)
    report_mask_metadata = {
        key: value
        for key, value in mask_metadata.items()
        if key != "absolute_path"
    }
    report_torso_detail_metadata = {
        key: value
        for key, value in torso_detail_metadata.items()
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
            "torso_micro_normal": report_torso_detail_metadata,
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
            "body_torso_vertex_color_mask_present": bool(
                find_carrier_body_mesh() is not None
                and find_carrier_body_mesh().data.color_attributes.get(BODY_TORSO_MASK_NAME) is not None
            ),
        },
        "validation": validation,
        "notes": [
            "This older direct Reallusion CC3 template did not import with facial shape keys; the account-gated newer free base package may be needed for blink/jaw morph tests.",
            "Integrated gore/cyborg regions are authored through mesh edits, material zones, and vertex color masks; detached face props remain forbidden.",
            "No Reallusion textures are embedded in the runtime GLB; runtime textures are generated experiment masks/details.",
            "The torso wound uses the packed skin mask atlas plus a generated micro-normal detail map for local sinew/clot breakup.",
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
    carrier_obj = find_carrier_body_mesh()
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
        "material_count_within_agent_budget": glb_stats["material_count"] <= MAX_EXPERIMENT_MATERIALS,
        "animations_preserved": glb_stats["animation_count"] >= 80,
        "carrier_head_cut_performed": removed_faces > 0,
        "head_vertex_color_mask_present": bool(
            head_obj is not None and head_obj.data.color_attributes.get("rl_head_region_mask") is not None
        ),
        "body_torso_vertex_color_mask_present": bool(
            carrier_obj is not None and carrier_obj.data.color_attributes.get(BODY_TORSO_MASK_NAME) is not None
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
    snapshots = flatten_runtime_base_color_links_for_export()
    try:
        bpy.ops.export_scene.gltf(
            filepath=str(path),
            export_format="GLB",
            export_animations=True,
            export_apply=False,
            export_yup=True,
        )
    finally:
        restore_runtime_base_color_links(snapshots)


def flatten_runtime_base_color_links_for_export() -> list[tuple[bpy.types.Material, bpy.types.NodeSocket, list[bpy.types.NodeSocket], tuple[float, float, float, float]]]:
    """Keep mask atlases as authoring inputs, but do not export them as visible albedo."""
    snapshots = []
    for mat in bpy.data.materials:
        if not mat.name.startswith("EX_") or not mat.use_nodes:
            continue
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf is None:
            continue
        base_color = bsdf.inputs.get("Base Color")
        if base_color is None:
            continue
        source_sockets = [link.from_socket for link in list(base_color.links)]
        default = tuple(base_color.default_value)
        snapshots.append((mat, base_color, source_sockets, default))
        for link in list(base_color.links):
            mat.node_tree.links.remove(link)
        base_color.default_value = mat.diffuse_color
    return snapshots


def restore_runtime_base_color_links(
    snapshots: list[tuple[bpy.types.Material, bpy.types.NodeSocket, list[bpy.types.NodeSocket], tuple[float, float, float, float]]],
) -> None:
    for mat, base_color, source_sockets, default in snapshots:
        base_color.default_value = default
        for source_socket in source_sockets:
            mat.node_tree.links.new(source_socket, base_color)


if __name__ == "__main__":
    main()
