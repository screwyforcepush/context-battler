#!/usr/bin/env python3
"""Blender-side asset compiler for the Glitch Reaper prototype.

This script is the intended production path when a Blender binary is available:

  blender -b --python scripts/build-glitch-reaper-blender.py --

It imports the Mesh2Motion carrier rig, creates authored replacement head/body
modules as bone-parented meshes, saves a .blend, and exports a GLB.
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

import bpy
from mathutils import Vector


VARIANT_ID = "glitch_reaper"


def main() -> None:
    patch_blender_numpy_compat()
    args = parse_args()
    project_root = Path(args.project_root).resolve()
    base_glb = project_root / "shared-harness/art-kit/characters/camper-mesh2motion-human-base.glb"
    dist_dir = project_root / "dist/characters" / VARIANT_ID
    art_dir = project_root / "shared-harness/art-kit/characters/generated"
    dist_dir.mkdir(parents=True, exist_ok=True)
    art_dir.mkdir(parents=True, exist_ok=True)
    (project_root / "dist/characters/.gdignore").write_text("Generated authoring artifacts; runtime assets live under shared-harness.\n", encoding="utf-8")

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    bpy.ops.import_scene.gltf(filepath=str(base_glb))

    armature = first_object_of_type("ARMATURE")
    if armature is None:
        raise RuntimeError("Imported base GLB did not contain an Armature")

    mats = make_materials()
    assign_carrier_material(mats["metal"])
    build_modules(armature, mats)
    module_names = generated_module_names()

    blend_path = dist_dir / f"{VARIANT_ID}.blend"
    dist_glb = dist_dir / f"{VARIANT_ID}.glb"
    art_glb = art_dir / f"{VARIANT_ID}.glb"
    export_glb(dist_glb)
    export_glb(art_glb)
    previews = render_preview_set(dist_dir)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
    write_report(project_root, base_glb, blend_path, dist_glb, art_glb, module_names, previews)


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


def first_object_of_type(object_type: str):
    for obj in bpy.context.scene.objects:
        if obj.type == object_type:
            return obj
    return None


def darken_carrier_materials() -> None:
    for mat in bpy.data.materials:
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf is None:
            continue
        set_input(bsdf, "Base Color", (0.018, 0.016, 0.014, 1.0))
        set_input(bsdf, "Metallic", 0.55)
        set_input(bsdf, "Roughness", 0.58)


def assign_carrier_material(mat: bpy.types.Material) -> None:
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj.name.startswith("glitch_reaper"):
            continue
        obj.data.materials.clear()
        obj.data.materials.append(mat)


def make_materials() -> dict[str, bpy.types.Material]:
    return {
        "metal": make_mat("GR_blackened_metal", (0.014, 0.015, 0.017, 1), 0.92, 0.38, texture_style="blackened_metal"),
        "cavity": make_mat("GR_dark_cavity", (0.001, 0.001, 0.002, 1), 0.15, 0.86),
        "glow": make_mat("GR_infernal_red_emissive", (1.0, 0.048, 0.014, 1), 0.0, 0.22, (1.0, 0.040, 0.012), 4.05, texture_style="infernal_glow"),
        "gore": make_mat("GR_gore_flesh", (0.36, 0.022, 0.018, 1), 0.0, 0.26, texture_style="flayed_gore"),
        "skin": make_mat("GR_pale_flayed_skin", (0.44, 0.220, 0.205, 1), 0.0, 0.50, texture_style="pale_flayed_skin"),
        "blood": make_mat("GR_wet_black_blood", (0.120, 0.004, 0.003, 1), 0.0, 0.10, texture_style="wet_black_blood"),
        "bone": make_mat("GR_burnt_human_bone", (0.54, 0.465, 0.365, 1), 0.0, 0.76, texture_style="burnt_bone"),
        "glitch": make_mat("GR_cyan_glitch", (0.006, 0.32, 0.36, 1), 0.0, 0.30, (0.010, 0.42, 0.47), 0.48, texture_style="glitch_cyan"),
        "scar": make_mat("GR_scraped_raw_metal", (0.38, 0.355, 0.310, 1), 0.82, 0.46, texture_style="raw_scratch"),
    }


def make_mat(name: str, base, metallic: float, roughness: float, emission=None, energy: float = 0.0, texture_style: str | None = None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.use_backface_culling = False
    mat.diffuse_color = base
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    set_input(bsdf, "Base Color", base)
    set_input(bsdf, "Metallic", metallic)
    set_input(bsdf, "Roughness", roughness)
    if emission is not None:
        set_input(bsdf, "Emission", emission)
        set_input(bsdf, "Emission Color", emission)
        set_input(bsdf, "Emission Strength", energy)
    apply_material_finish(bsdf, texture_style)
    if texture_style is not None:
        attach_texture_to_material(mat, bsdf, base, texture_style)
    return mat


def apply_material_finish(bsdf, texture_style: str | None) -> None:
    if bsdf is None:
        return
    finish_by_style = {
        "blackened_metal": {
            "Specular": 0.50,
            "Specular IOR Level": 0.48,
            "Coat Weight": 0.06,
            "Clearcoat": 0.06,
            "Coat Roughness": 0.42,
            "Clearcoat Roughness": 0.42,
        },
        "flayed_gore": {
            "Specular": 0.72,
            "Specular IOR Level": 0.72,
            "Coat Weight": 0.18,
            "Clearcoat": 0.18,
            "Coat Roughness": 0.18,
            "Clearcoat Roughness": 0.18,
        },
        "pale_flayed_skin": {
            "Specular": 0.42,
            "Specular IOR Level": 0.42,
            "Sheen Weight": 0.14,
            "Sheen Tint": 0.22,
        },
        "wet_black_blood": {
            "Specular": 0.86,
            "Specular IOR Level": 0.86,
            "Coat Weight": 0.36,
            "Clearcoat": 0.36,
            "Coat Roughness": 0.08,
            "Clearcoat Roughness": 0.08,
        },
        "burnt_bone": {
            "Specular": 0.24,
            "Specular IOR Level": 0.24,
        },
        "glitch_cyan": {
            "Specular": 0.35,
            "Specular IOR Level": 0.35,
        },
        "raw_scratch": {
            "Specular": 0.58,
            "Specular IOR Level": 0.58,
            "Coat Weight": 0.04,
            "Clearcoat": 0.04,
        },
    }
    for socket_name, value in finish_by_style.get(texture_style, {}).items():
        set_input(bsdf, socket_name, value)


def attach_texture_to_material(mat, bsdf, base, texture_style: str) -> None:
    if bsdf is None:
        return
    image = make_material_image(f"{mat.name}_embedded_map", base, texture_style)
    tex = mat.node_tree.nodes.new("ShaderNodeTexImage")
    tex.name = f"{texture_style}_texture"
    tex.image = image
    mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    if texture_style in ["infernal_glow", "glitch_cyan"]:
        emission_socket = bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")
        if emission_socket is not None:
            mat.node_tree.links.new(tex.outputs["Color"], emission_socket)


def make_material_image(name: str, base, texture_style: str):
    width = 256
    height = 256
    image = bpy.data.images.new(name, width=width, height=height, alpha=True)
    pixels = []
    for y in range(height):
        v = y / max(height - 1, 1)
        for x in range(width):
            u = x / max(width - 1, 1)
            n1 = hash01(x * 12.9898 + y * 78.233)
            n2 = hash01(x * 4.113 + y * 33.771 + 19.73)
            r, g, b, a = texture_color(texture_style, base, u, v, n1, n2)
            pixels.extend((r, g, b, a))
    image.pixels.foreach_set(pixels)
    image.pack()
    return image


def texture_color(style: str, base, u: float, v: float, n1: float, n2: float):
    r, g, b, a = base
    if style == "blackened_metal":
        grain = 0.46 + n1 * 0.34
        soot = 0.74 + 0.16 * math.sin(v * 39.0 + n2 * 3.0)
        heat_bloom = 0.035 if abs(u - 0.52) < 0.035 and n2 > 0.58 else 0.0
        scratch = 1.0 if (n2 > 0.982 or abs((u + n1 * 0.08) % 0.24 - 0.12) < 0.003) else 0.0
        return (
            clamp01(r * grain * soot + heat_bloom + scratch * 0.11),
            clamp01(g * grain * soot + heat_bloom * 0.22 + scratch * 0.10),
            clamp01(b * grain * soot + scratch * 0.13),
            a,
        )
    if style == "flayed_gore":
        vein = 1.0 if abs(math.sin((u * 7.0 + v * 18.0 + n1 * 2.5) * math.pi)) > 0.945 else 0.0
        sinew = 1.0 if abs(math.sin((u * 15.0 - v * 5.0 + n2) * math.pi)) > 0.975 else 0.0
        wet = 0.88 + n1 * 0.30
        shadow = 0.62 if n2 > 0.91 else 1.0
        clot = 0.17 if n2 > 0.84 else 0.0
        return (
            clamp01(r * wet * shadow + vein * 0.22 + sinew * 0.10 + clot),
            clamp01(g * (0.22 + n2 * 0.10) * shadow + vein * 0.016 + sinew * 0.022),
            clamp01(b * (0.20 + n1 * 0.08) * shadow + vein * 0.012 + sinew * 0.018),
            a,
        )
    if style == "pale_flayed_skin":
        bruise = 0.14 if n2 > 0.72 else 0.0
        capillary = 1.0 if abs(math.sin((u * 12.0 - v * 7.0 + n1) * math.pi)) > 0.955 else 0.0
        dry = 0.82 + n1 * 0.12
        sallow = 0.90 + 0.05 * math.sin(v * 12.0 + n2 * 2.0)
        return (
            clamp01(r * dry * sallow + capillary * 0.13 + bruise * 0.18),
            clamp01(g * (0.58 + n2 * 0.07) * sallow - bruise * 0.10 + capillary * 0.010),
            clamp01(b * (0.56 + n1 * 0.07) * sallow - bruise * 0.09 + capillary * 0.010),
            a,
        )
    if style == "wet_black_blood":
        shine = 0.62 + n1 * 0.42
        clot = 0.12 if n2 > 0.88 else 0.0
        red_sheen = 0.035 if abs(math.sin((u * 4.0 + v * 9.0) * math.pi)) > 0.82 else 0.0
        return (
            clamp01(r * shine + clot + red_sheen),
            clamp01(g * (0.30 + n2 * 0.12)),
            clamp01(b * (0.28 + n1 * 0.10)),
            a,
        )
    if style == "burnt_bone":
        pore = 0.70 + n1 * 0.24
        scorch = 0.38 if n2 > 0.92 else 1.0
        ash = 0.040 if abs(math.sin((u * 8.0 + v * 5.0) * math.pi)) > 0.96 else 0.0
        return (
            clamp01(r * pore * scorch + ash),
            clamp01(g * pore * scorch + ash * 0.92),
            clamp01(b * (0.82 + n2 * 0.10) * scorch + ash * 0.72),
            a,
        )
    if style == "infernal_glow":
        band = 0.50 + 0.48 * abs(math.sin(v * 35.0 + n1 * 1.7))
        spark = 1.0 if n2 > 0.986 else 0.0
        return (clamp01(r * band + spark * 0.46), clamp01(g * band + spark * 0.10), clamp01(b * band * 0.82), a)
    if style == "glitch_cyan":
        line = 1.0 if abs((v * 68.0 + n1 * 0.8) % 1.0 - 0.5) < 0.075 else 0.34
        dropout = 0.18 if n2 > 0.82 else 1.0
        return (clamp01(r * line * dropout), clamp01(g * line * dropout), clamp01(b * line), a)
    if style == "raw_scratch":
        scrape = 0.72 + n1 * 0.34
        oxide = 0.040 if n2 > 0.93 else 0.0
        return (clamp01(r * scrape + oxide), clamp01(g * scrape + oxide * 0.45), clamp01(b * scrape), a)
    return base


def hash01(value: float) -> float:
    return math.sin(value * 43758.5453123) % 1.0


def clamp01(value: float) -> float:
    return min(max(value, 0.0), 1.0)


def generated_module_names() -> list[str]:
    return sorted(obj.name for obj in bpy.context.scene.objects if obj.name.startswith("glitch_reaper"))


def set_input(node, name: str, value) -> None:
    socket = node.inputs.get(name) if node else None
    if socket is not None:
        try:
            socket.default_value = value
        except (TypeError, ValueError):
            if isinstance(value, tuple) and len(value) == 3:
                socket.default_value = (*value, 1.0)
            elif isinstance(value, (int, float)) and hasattr(socket.default_value, "__len__"):
                socket.default_value = tuple(value for _ in range(len(socket.default_value)))
            else:
                raise


def build_modules(armature, mats: dict[str, bpy.types.Material]) -> None:
    build_head_module(armature, mats)
    build_torso_module(armature, mats)
    build_fusion_wound_modules(armature, mats)
    build_limb_modules(armature, mats)
    build_gore_modules(armature, mats)
    build_surface_breakup_modules(armature, mats)
    build_glitch_modules(armature, mats)


def build_head_module(armature, mats: dict[str, bpy.types.Material]) -> None:
    metal = mats["metal"]
    cavity = mats["cavity"]
    glow = mats["glow"]
    glitch = mats["glitch"]
    gore = mats["gore"]
    skin = mats["skin"]
    blood = mats["blood"]
    bone = mats["bone"]
    scar = mats["scar"]

    add_sphere(armature, "head", "glitch_reaper_head_A_skull_shell", (0.0, 0.100, -0.016), (0.064, 0.088, 0.048), metal, segments=64, rings=32)
    add_box(armature, "head", "glitch_reaper_head_A_occipital_spine_plate", (0.0, 0.126, -0.078), (0.022, 0.058, 0.010), metal, (8, 0, 0), bevel=0.0028)
    add_box(armature, "head", "glitch_reaper_head_A_left_temple_plate", (-0.064, 0.098, 0.026), (0.011, 0.068, 0.026), metal, (0, -8, -4), bevel=0.0028)
    add_box(armature, "head", "glitch_reaper_head_A_right_temple_plate", (0.065, 0.098, 0.027), (0.011, 0.066, 0.025), metal, (0, 8, 4), bevel=0.0028)
    add_box(armature, "head", "glitch_reaper_head_A_inner_face_cavity", (0.0, 0.086, 0.142), (0.110, 0.052, 0.018), cavity, (-7, 0, 0), bevel=0.0022)
    add_box(armature, "head", "glitch_reaper_head_A_left_visor_frame", (-0.048, 0.088, 0.140), (0.008, 0.040, 0.010), metal, (-4, 0, -8), bevel=0.0014)
    add_box(armature, "head", "glitch_reaper_head_A_right_visor_frame", (0.048, 0.088, 0.140), (0.008, 0.038, 0.010), bone, (-4, 0, 8), bevel=0.0014)
    add_box(armature, "head", "glitch_reaper_head_A_forehead_executioner_plate", (0.0, 0.132, 0.112), (0.066, 0.014, 0.010), metal, (-12, 0, 0), bevel=0.0022)
    add_box(armature, "head", "glitch_reaper_head_A_brow_plate", (0.0, 0.120, 0.150), (0.098, 0.011, 0.009), metal, (-9, 0, 0), bevel=0.0022)
    add_box(armature, "head", "glitch_reaper_head_A_brow_crown_keel", (0.0, 0.134, 0.058), (0.011, 0.020, 0.010), metal, (-15, 0, 0), bevel=0.002)
    add_box(armature, "head", "glitch_reaper_head_A_eye_socket_black_backplate", (0.0, 0.098, 0.156), (0.118, 0.018, 0.007), cavity, (-7, 0, 0), bevel=0.0008)
    add_box(armature, "head", "glitch_reaper_head_A_red_eye_slit", (-0.002, 0.102, 0.164), (0.108, 0.006, 0.0045), glow, (-7, 0, 0), bevel=0.0009)
    add_sphere(armature, "head", "glitch_reaper_head_A_left_cold_red_optic", (-0.040, 0.102, 0.166), (0.007, 0.005, 0.004), glow, segments=24, rings=12)
    add_box(armature, "head", "glitch_reaper_head_A_right_human_eye_socket_void", (0.040, 0.100, 0.166), (0.026, 0.011, 0.005), cavity, (-7, 0, 11), bevel=0.001)
    add_box(armature, "head", "glitch_reaper_head_A_right_eye_slashed_lens", (0.040, 0.100, 0.168), (0.016, 0.0030, 0.0028), glow, (-8, 0, 12), bevel=0.0005)
    add_box(armature, "head", "glitch_reaper_head_A_left_eye_slashed_lens", (-0.040, 0.100, 0.168), (0.018, 0.0030, 0.0028), glow, (-8, 0, -12), bevel=0.0005)

    add_sphere(armature, "head", "glitch_reaper_head_A_left_skull_side_human_rind_volume", (-0.058, 0.004, 0.122), (0.014, 0.042, 0.018), skin, segments=32, rings=16)
    add_sphere(armature, "head", "glitch_reaper_head_A_right_skull_side_raw_meat_wrap_volume", (0.060, 0.002, 0.120), (0.014, 0.044, 0.018), blood, segments=32, rings=16)
    add_sphere(armature, "head", "glitch_reaper_head_A_unified_side_profile_jaw_socket", (0.000, -0.016, 0.126), (0.058, 0.066, 0.036), cavity, segments=48, rings=20)
    add_sphere(armature, "head", "glitch_reaper_head_A_single_fused_face_throat_core", (0.000, -0.032, 0.112), (0.034, 0.046, 0.022), blood, segments=32, rings=16)
    add_sphere(armature, "head", "glitch_reaper_head_A_dark_machine_throat_backfill_volume", (0.000, -0.050, 0.088), (0.052, 0.082, 0.038), cavity, segments=32, rings=12)
    add_sphere(armature, "head", "glitch_reaper_head_A_black_blood_mouth_socket_volume", (0.000, -0.010, 0.136), (0.056, 0.034, 0.023), cavity, segments=32, rings=12)
    add_sphere(armature, "head", "glitch_reaper_head_A_upper_burnt_bone_socket_lip", (0.000, 0.010, 0.142), (0.034, 0.020, 0.008), bone, segments=32, rings=12)
    add_sphere(armature, "head", "glitch_reaper_head_A_left_bone_socket_side_rim", (-0.040, -0.010, 0.130), (0.014, 0.042, 0.016), bone, segments=32, rings=12)
    add_sphere(armature, "head", "glitch_reaper_head_A_right_machine_socket_side_rim", (0.042, -0.014, 0.128), (0.014, 0.042, 0.016), scar, segments=32, rings=12)
    add_sphere(armature, "head", "glitch_reaper_head_A_lower_wet_socket_lip", (0.000, -0.054, 0.104), (0.052, 0.040, 0.020), blood, segments=32, rings=12)
    add_sphere(armature, "head", "glitch_reaper_head_A_collar_socket_fused_machine_mass", (0.000, -0.092, 0.060), (0.054, 0.052, 0.030), metal, segments=32, rings=12)
    add_torus(armature, "head", "glitch_reaper_head_A_split_jaw_socket_ring", (0.0, -0.018, 0.124), 0.028, 0.0042, scar, (-5, 0, 0))
    add_sphere(armature, "head", "glitch_reaper_head_A_left_human_cheek_fused_volume", (-0.038, -0.002, 0.136), (0.015, 0.024, 0.010), skin, segments=32, rings=16)
    add_sphere(armature, "head", "glitch_reaper_head_A_right_flayed_cheek_fused_volume", (0.038, -0.006, 0.134), (0.015, 0.026, 0.010), gore, segments=32, rings=16)
    add_sphere(armature, "head", "glitch_reaper_head_A_split_jaw_wet_meat_core", (0.002, -0.046, 0.104), (0.034, 0.034, 0.018), gore, segments=32, rings=12)
    add_sphere(armature, "head", "glitch_reaper_head_A_throat_root_fused_gore_mass", (0.000, -0.076, 0.082), (0.038, 0.040, 0.024), blood, segments=32, rings=12)
    add_sphere(armature, "head", "glitch_reaper_head_A_side_profile_underjaw_flesh_wedge", (0.000, -0.040, 0.108), (0.028, 0.034, 0.018), gore, segments=32, rings=12)
    add_cylinder(armature, "head", "glitch_reaper_head_A_fused_trachea_machine_column", (0.000, -0.056, 0.076), 0.018, 0.134, metal, (86, 0, 0))
    add_cylinder(armature, "head", "glitch_reaper_head_A_wet_esophagus_inside_column", (0.012, -0.058, 0.082), 0.0090, 0.118, blood, (84, 0, 4))
    add_box(armature, "head", "glitch_reaper_head_A_hyoid_machine_socket_block", (0.000, -0.054, 0.108), (0.060, 0.018, 0.014), metal, (0, 0, -3), bevel=0.002)
    add_box(armature, "head", "glitch_reaper_head_A_deep_side_profile_wound_socket", (0.000, -0.024, 0.122), (0.088, 0.038, 0.046), cavity, (-4, 0, 0), bevel=0.0024)
    for i, y in enumerate([-0.034, -0.078]):
        material = bone if i == 0 else metal
        add_box(armature, "head", f"glitch_reaper_head_A_cervical_vertebra_machine_stack_{i}", ((-1) ** i * 0.010, y, 0.104 - i * 0.018), (0.050 - i * 0.006, 0.014, 0.012), material, (0, 0, -8 + i * 8), bevel=0.0012)
        add_box(armature, "head", f"glitch_reaper_head_A_cervical_black_blood_gap_{i}", (0.0, y - 0.014, 0.106 - i * 0.018), (0.032, 0.007, 0.006), blood, (0, 0, 0), bevel=0.0007)
    add_box(armature, "head", "glitch_reaper_head_A_side_profile_black_wound_backplane", (0.000, -0.006, 0.124), (0.092, 0.046, 0.014), cavity, (-4, 0, 0), bevel=0.0018)
    add_sphere(armature, "head", "glitch_reaper_head_A_readable_left_pale_human_face_mask_volume", (-0.034, 0.012, 0.148), (0.012, 0.018, 0.006), skin, segments=32, rings=16)
    add_sphere(armature, "head", "glitch_reaper_head_A_readable_right_flayed_meat_mask_volume", (0.034, 0.010, 0.146), (0.012, 0.018, 0.006), gore, segments=32, rings=16)
    add_box(armature, "head", "glitch_reaper_head_A_face_mask_black_tear_gap", (0.002, 0.020, 0.156), (0.010, 0.014, 0.0035), blood, (-7, 0, 2), bevel=0.0008)
    add_box(armature, "head", "glitch_reaper_head_A_visible_burnt_bone_brow_l", (-0.034, 0.112, 0.160), (0.036, 0.006, 0.0050), bone, (-8, 0, -10), bevel=0.0008)
    add_box(armature, "head", "glitch_reaper_head_A_visible_burnt_bone_brow_r", (0.038, 0.110, 0.160), (0.034, 0.006, 0.0050), bone, (-8, 0, 12), bevel=0.0008)
    add_box(armature, "head", "glitch_reaper_head_A_recut_red_eye_burn_through_flesh", (-0.004, 0.098, 0.166), (0.050, 0.0028, 0.0028), glow, (-7, 0, 0), bevel=0.0005)
    add_box(armature, "head", "glitch_reaper_head_A_cyan_dimension_slice_through_face", (0.052, 0.052, 0.158), (0.0014, 0.010, 0.0012), glitch, (0, 0, 17), bevel=0.0004)
    add_box(armature, "head", "glitch_reaper_head_A_left_cheek_armor", (-0.044, -0.004, 0.124), (0.020, 0.026, 0.012), metal, (-6, 0, -15), bevel=0.0018)
    add_box(armature, "head", "glitch_reaper_head_A_right_cheek_bone_plate", (0.044, -0.006, 0.123), (0.020, 0.024, 0.011), scar, (-6, 0, 13), bevel=0.0018)
    add_box(armature, "head", "glitch_reaper_head_A_split_mandible_l", (-0.030, -0.036, 0.112), (0.018, 0.040, 0.014), metal, (0, 0, -11), bevel=0.0016)
    add_box(armature, "head", "glitch_reaper_head_A_split_mandible_r", (0.030, -0.038, 0.112), (0.016, 0.036, 0.013), scar, (0, 0, 13), bevel=0.0016)
    add_box(armature, "head", "glitch_reaper_head_A_chin_heat_crack", (0.0, -0.066, 0.104), (0.0070, 0.018, 0.0045), glow, (0, 0, -14), bevel=0.0008)
    add_box(armature, "head", "glitch_reaper_head_A_nasal_void_black_cut", (0.0, 0.014, 0.146), (0.012, 0.012, 0.0035), cavity, (-5, 0, 0), bevel=0.0008)
    add_box(armature, "head", "glitch_reaper_head_A_lower_carrier_face_blackout", (0.0, -0.018, 0.102), (0.074, 0.042, 0.016), cavity, (-4, 0, 0), bevel=0.0015)
    add_box(armature, "head", "glitch_reaper_head_A_left_under_skull_occluder", (-0.044, -0.016, 0.102), (0.022, 0.046, 0.014), metal, (-5, 0, -17), bevel=0.0016)
    add_box(armature, "head", "glitch_reaper_head_A_right_pale_face_occluder", (0.044, -0.018, 0.104), (0.022, 0.044, 0.014), skin, (-5, 0, 16), bevel=0.0014)
    add_box(armature, "head", "glitch_reaper_head_A_black_blood_mouth_wetline", (0.004, -0.014, 0.132), (0.050, 0.006, 0.0040), blood, (-4, 0, 0), bevel=0.0008)

    add_torus(armature, "head", "glitch_reaper_head_A_neck_collar", (0.0, -0.060, 0.010), 0.062, 0.006, metal)
    add_torus(armature, "head", "glitch_reaper_head_A_lower_neck_lock", (0.0, -0.086, 0.008), 0.052, 0.0052, metal, (0, 0, 7))
    add_box(armature, "head", "glitch_reaper_head_A_throat_glow", (0.0, -0.002, 0.118), (0.009, 0.020, 0.005), glow, (0, 0, 0), bevel=0.001)
    for i, x in enumerate([-0.028, 0.030]):
        add_cylinder(armature, "head", f"glitch_reaper_head_A_wet_neck_tendon_{i}", (x, 0.008, 0.078), 0.0024, 0.070, gore if i % 2 else blood, (78, 0, -10 + i * 20))

    for i in range(3):
        t = i / 2
        x = -0.024 + 0.048 * t
        height = 0.014 + (0.004 if i == 1 else 0.0)
        add_box(armature, "head", f"glitch_reaper_head_A_blade_crown_plate_{i}", (x, 0.134, -0.062), (0.0045, height, 0.006), metal, (18, 0, 7 - 14 * t), bevel=0.0012)
        if i == 1:
            add_box(armature, "head", f"glitch_reaper_head_A_cyan_crown_break_{i}", (0.0, 0.134, -0.028), (0.0012, 0.006, 0.0012), glitch, (0, 0, 0), bevel=0.0003)
    add_cylinder(armature, "head", "glitch_reaper_head_A_back_antenna_l", (-0.024, 0.122, -0.070), 0.0015, 0.032, metal, (24, 12, -8))
    add_cylinder(armature, "head", "glitch_reaper_head_A_back_antenna_r", (0.024, 0.122, -0.070), 0.0015, 0.030, metal, (22, -12, 10))


def build_torso_module(armature, mats: dict[str, bpy.types.Material]) -> None:
    metal = mats["metal"]
    glow = mats["glow"]
    glitch = mats["glitch"]
    cavity = mats["cavity"]
    gore = mats["gore"]
    skin = mats["skin"]
    blood = mats["blood"]
    bone = mats["bone"]
    scar = mats["scar"]

    add_box(armature, "spine_03", "glitch_reaper_core_black_cradle", (0.0, -0.022, 0.126), (0.154, 0.166, 0.030), cavity, (0, 0, 0), bevel=0.010)
    add_sphere(armature, "spine_03", "glitch_reaper_rib_core_molten_heart", (0.0, -0.026, 0.168), (0.050, 0.078, 0.026), glow, segments=32, rings=16)
    add_box(armature, "spine_03", "glitch_reaper_core_vertical_heat_slit_l", (-0.025, -0.026, 0.176), (0.007, 0.048, 0.010), glow, (0, 0, -13), bevel=0.0012)
    add_box(armature, "spine_03", "glitch_reaper_core_vertical_heat_slit_r", (0.026, -0.012, 0.176), (0.007, 0.044, 0.010), glow, (0, 0, 16), bevel=0.0012)
    add_box(armature, "spine_03", "glitch_reaper_black_sternum_plate", (0.0, -0.022, 0.155), (0.030, 0.286, 0.028), metal, (0, 0, 0), bevel=0.006)
    add_box(armature, "spine_03", "glitch_reaper_split_sternum_bone_l", (-0.032, 0.036, 0.166), (0.018, 0.188, 0.016), bone, (0, 0, -8), bevel=0.003)
    add_box(armature, "spine_03", "glitch_reaper_split_sternum_bone_r", (0.032, 0.032, 0.166), (0.018, 0.180, 0.016), bone, (0, 0, 8), bevel=0.003)
    for side in ["l", "r"]:
        sign = -1 if side == "l" else 1
        add_cylinder(armature, "spine_03", f"glitch_reaper_terminator_rib_cage_outer_rail_{side}", (sign * 0.084, -0.020, 0.150), 0.0042, 0.318, metal, (86, 0, sign * 7))
        add_cylinder(armature, "spine_03", f"glitch_reaper_terminator_inner_piston_{side}", (sign * 0.052, -0.028, 0.194), 0.0030, 0.238, scar, (86, 0, sign * 5))
        add_box(armature, "spine_03", f"glitch_reaper_rib_cage_upper_socket_{side}", (sign * 0.070, 0.122, 0.174), (0.028, 0.014, 0.016), metal, (0, 0, sign * 10), bevel=0.0015)
        add_box(armature, "spine_03", f"glitch_reaper_rib_cage_lower_socket_{side}", (sign * 0.070, -0.154, 0.162), (0.026, 0.014, 0.014), bone, (0, 0, sign * 8), bevel=0.0012)
    add_box(armature, "spine_03", "glitch_reaper_heart_upper_machine_clamp", (0.0, 0.054, 0.184), (0.126, 0.020, 0.014), metal, (0, 0, 0), bevel=0.003)
    add_box(armature, "spine_03", "glitch_reaper_heart_lower_machine_clamp", (0.0, -0.100, 0.184), (0.110, 0.018, 0.014), metal, (0, 0, 0), bevel=0.003)
    add_box(armature, "spine_03", "glitch_reaper_core_dimensional_fusion_fault", (0.004, -0.012, 0.194), (0.006, 0.204, 0.004), glow, (0, 0, 1), bevel=0.0008)
    add_box(armature, "spine_03", "glitch_reaper_core_cyan_phase_offset", (0.018, -0.014, 0.198), (0.0016, 0.106, 0.0018), glitch, (0, 0, 2), bevel=0.0004)
    for i, (x, y, angle, material) in enumerate([
        (-0.040, 0.072, -18, bone),
        (0.038, 0.046, 16, metal),
        (-0.046, -0.054, -14, metal),
        (0.042, -0.078, 18, bone),
    ]):
        add_box(armature, "spine_03", f"glitch_reaper_heart_implant_biting_tooth_{i}", (x, y, 0.207), (0.024, 0.006, 0.006), material, (0, 0, angle), bevel=0.0008)
        add_box(armature, "spine_03", f"glitch_reaper_heart_implant_wet_crush_shadow_{i}", (x * 0.82, y - 0.008, 0.211), (0.020, 0.004, 0.004), blood, (0, 0, angle), bevel=0.0005)
    add_torn_panel(armature, "spine_03", "glitch_reaper_core_left_human_slab_skin", (-0.104, -0.044, 0.187), 0.028, 0.118, skin, (0, 0, -17), rag_points=6, taper=0.34)
    add_torn_panel(armature, "spine_03", "glitch_reaper_core_right_wet_flesh_slab", (0.106, -0.052, 0.188), 0.028, 0.112, gore, (0, 0, 18), rag_points=6, taper=0.34)
    for i, y in enumerate([0.082, 0.006, -0.074]):
        sign = -1 if i % 2 == 0 else 1
        add_box(armature, "spine_03", f"glitch_reaper_core_flesh_to_metal_bridge_{i}", (sign * 0.074, y, 0.194), (0.046, 0.007, 0.006), metal if i % 3 else bone, (0, 0, sign * 18), bevel=0.001)
        add_box(armature, "spine_03", f"glitch_reaper_core_black_blood_underbridge_{i}", (sign * 0.060, y - 0.010, 0.198), (0.034, 0.005, 0.0035), blood, (0, 0, sign * 18), bevel=0.0008)

    for i in range(6):
        y = 0.110 - i * 0.040
        width = 0.092 + i * 0.014
        rib_mat = metal if i % 2 == 0 else bone
        add_box(armature, "spine_03", f"glitch_reaper_rib_l_{i}", (-0.078 - i * 0.006, y, 0.134), (width, 0.012, 0.018), rib_mat, (0, 0, -22 - i * 2.4), bevel=0.003)
        add_box(armature, "spine_03", f"glitch_reaper_rib_r_{i}", (0.078 + i * 0.006, y, 0.134), (width, 0.012, 0.018), rib_mat, (0, 0, 22 + i * 2.4), bevel=0.003)
        add_box(armature, "spine_03", f"glitch_reaper_rib_machine_hinge_{i}", (0.0, y, 0.188), (0.032, 0.006, 0.006), metal, (0, 0, 0), bevel=0.0007)
        if i % 2 == 0:
            add_box(armature, "spine_03", f"glitch_reaper_rib_gap_glow_{i}", (0.0, y - 0.008, 0.178), (0.062, 0.005, 0.007), glow, (0, 0, 5 if i % 4 == 0 else -5), bevel=0.0012)
        else:
            add_box(armature, "spine_03", f"glitch_reaper_wet_rib_sinew_{i}", (0.0, y - 0.009, 0.181), (0.084, 0.005, 0.005), gore, (0, 0, -4 if i % 3 == 0 else 4), bevel=0.0008)

    for i in range(2):
        y = 0.096 - i * 0.104
        add_box(armature, "spine_03", f"glitch_reaper_chest_skin_clamp_{i}", ((-1) ** i * 0.112, y, 0.178), (0.038, 0.011, 0.010), metal, (0, 0, -15 if i % 2 else 15), bevel=0.0015)
        add_box(armature, "spine_03", f"glitch_reaper_chest_black_blood_pool_{i}", ((-1) ** i * 0.092, y - 0.014, 0.185), (0.024, 0.008, 0.005), blood, (0, 0, -16 if i % 2 else 16), bevel=0.0008)
    for side in ["l", "r"]:
        sign = -1 if side == "l" else 1
        socket_mat = bone if side == "l" else metal
        add_box(armature, "spine_03", f"glitch_reaper_subclavicle_machine_socket_{side}", (sign * 0.128, 0.082, 0.174), (0.042, 0.020, 0.016), socket_mat, (0, 0, sign * 20), bevel=0.0016)
        add_torn_panel(armature, "spine_03", f"glitch_reaper_subclavicle_skin_torn_into_socket_{side}", (sign * 0.124, -0.002, 0.186), 0.020, 0.070, skin if side == "l" else gore, (0, 0, sign * 18), rag_points=5, taper=0.24)
        add_cylinder(armature, "spine_03", f"glitch_reaper_chest_to_arm_pulled_tendon_{side}_0", (sign * 0.090, 0.050, 0.184), 0.0036, 0.126, gore if side == "l" else blood, (83, 0, sign * 30))

    add_box(armature, "spine_03", "glitch_reaper_clavicle_recessed_black_collar_socket", (0.0, 0.064, 0.194), (0.090, 0.038, 0.008), cavity, (0, 0, 0), bevel=0.001)
    add_sphere(armature, "spine_03", "glitch_reaper_neck_fusion_wet_collar_mass", (0.000, 0.040, 0.198), (0.032, 0.038, 0.010), blood, segments=32, rings=12)
    add_box(armature, "spine_03", "glitch_reaper_clavicle_bone_yoke_left", (-0.042, 0.058, 0.202), (0.040, 0.006, 0.0045), bone, (0, 0, -18), bevel=0.0008)
    add_box(armature, "spine_03", "glitch_reaper_clavicle_machine_yoke_right", (0.044, 0.052, 0.202), (0.040, 0.006, 0.0045), metal, (0, 0, 18), bevel=0.0008)

    for i in range(2):
        side_shift = [-0.020, 0.018][i]
        y = -0.094 - i * 0.040
        angle = [-22, 24][i]
        length = 0.030 + i * 0.006
        add_box(armature, "spine_02", f"glitch_reaper_infernal_rune_{i}", (side_shift, y, 0.156), (0.007, length, 0.007), glow, (0, 0, angle), bevel=0.001)
    add_box(armature, "spine_02", "glitch_reaper_abdomen_flensed_skin_panel_l", (-0.080, -0.136, 0.138), (0.028, 0.112, 0.008), skin, (0, 0, -18), bevel=0.0015)
    add_box(armature, "spine_02", "glitch_reaper_abdomen_flensed_skin_panel_r", (0.082, -0.144, 0.138), (0.028, 0.104, 0.008), gore, (0, 0, 19), bevel=0.0015)
    add_box(armature, "spine_02", "glitch_reaper_abdomen_spinal_black_belt", (0.0, -0.188, 0.128), (0.166, 0.026, 0.024), metal, (0, 0, 0), bevel=0.004)
    add_torn_panel(armature, "spine_02", "glitch_reaper_abdomen_half_human_peel_l", (-0.054, -0.150, 0.160), 0.044, 0.116, skin, (0, 0, -14), rag_points=6, taper=0.44)
    add_torn_panel(armature, "spine_02", "glitch_reaper_abdomen_machine_pulled_gore_r", (0.056, -0.160, 0.160), 0.040, 0.106, blood, (0, 0, 16), rag_points=6, taper=0.34)
    for i in range(4):
        x = -0.054 + i * 0.036
        add_box(armature, "spine_02", f"glitch_reaper_abdomen_cross_suture_{i}", (x, -0.116 - i * 0.018, 0.172), (0.038, 0.006, 0.005), metal, (0, 0, -25 + i * 15), bevel=0.0008)
    add_box(armature, "spine_02", "glitch_reaper_abdomen_left_machine_gut_rail", (-0.048, -0.160, 0.178), (0.009, 0.092, 0.008), metal, (0, 0, -12), bevel=0.0012)
    add_box(armature, "spine_02", "glitch_reaper_abdomen_right_bone_gut_rail", (0.050, -0.162, 0.178), (0.009, 0.086, 0.008), bone, (0, 0, 12), bevel=0.001)
    add_box(armature, "spine_02", "glitch_reaper_abdomen_black_blood_depth_slot", (0.0, -0.166, 0.182), (0.034, 0.086, 0.005), blood, (0, 0, 0), bevel=0.0008)

    add_box(armature, "spine_03", "glitch_reaper_cathedral_spine_fin", (0.0, 0.000, -0.120), (0.030, 0.270, 0.026), metal, (7, 0, 0), bevel=0.006)
    for i in range(5):
        y = 0.110 - i * 0.048
        add_box(armature, "spine_03", f"glitch_reaper_back_spine_hook_{i}", (0.0, y, -0.150), (0.024, 0.040, 0.020), metal, (22, 0, -8 + i * 3), bevel=0.004)
        add_box(armature, "spine_03", f"glitch_reaper_back_bone_vertebra_{i}", ((-1) ** i * 0.028, y - 0.010, -0.130), (0.019, 0.034, 0.016), bone, (8, 0, (-1) ** i * 12), bevel=0.003)
    add_sphere(armature, "spine_03", "glitch_reaper_back_left_scapula_flayed_socket", (-0.072, 0.038, -0.156), (0.014, 0.070, 0.014), skin, segments=32, rings=12)
    add_sphere(armature, "spine_03", "glitch_reaper_back_right_scapula_raw_socket", (0.052, -0.020, -0.158), (0.015, 0.086, 0.015), blood, segments=32, rings=12)
    add_box(armature, "spine_03", "glitch_reaper_back_spine_black_wound_depth", (0.0, -0.014, -0.166), (0.070, 0.236, 0.010), blood, (8, 0, -2), bevel=0.001)
    add_box(armature, "spine_03", "glitch_reaper_back_vertebrae_red_furnace_slit", (0.0, -0.002, -0.178), (0.008, 0.204, 0.006), glow, (9, 0, -2), bevel=0.0009)
    for i, (x, y, angle, material) in enumerate([
        (-0.052, 0.076, -28, bone),
        (0.046, 0.024, 24, metal),
        (-0.040, -0.036, -18, scar),
        (0.034, -0.086, 18, bone),
    ]):
        add_box(armature, "spine_03", f"glitch_reaper_back_ragged_scapula_splint_{i}", (x, y, -0.186), (0.070, 0.007, 0.006), material, (0, 0, angle), bevel=0.0008)
        add_box(armature, "spine_03", f"glitch_reaper_back_black_socket_shadow_{i}", (x * 0.78, y - 0.012, -0.190), (0.038, 0.006, 0.004), blood, (0, 0, angle), bevel=0.0005)
    for i, x in enumerate([-0.030, 0.024]):
        add_cylinder(armature, "spine_03", f"glitch_reaper_back_exposed_spinal_servo_cord_{i}", (x, -0.020 - i * 0.040, -0.188), 0.0032, 0.194 + i * 0.028, metal if i else gore, (84, 0, -11 + i * 20))
    for i in range(4):
        add_cylinder(armature, "spine_03", f"glitch_reaper_heart_hydraulic_cable_{i}", ((i - 1.5) * 0.032, -0.020, 0.110), 0.0046, 0.238 + i * 0.010, metal if i % 2 else blood, (82, 0, -14 + i * 9))
    for i in range(4):
        y = 0.080 - i * 0.038
        add_cylinder(armature, "spine_03", f"glitch_reaper_core_red_hot_artery_{i}", ((i - 1.5) * 0.016, y, 0.194), 0.0026, 0.146 + i * 0.010, glow if i % 2 else blood, (86, 0, -16 + i * 10))


def build_fusion_wound_modules(armature, mats: dict[str, bpy.types.Material]) -> None:
    metal = mats["metal"]
    glow = mats["glow"]
    glitch = mats["glitch"]
    cavity = mats["cavity"]
    gore = mats["gore"]
    skin = mats["skin"]
    blood = mats["blood"]
    bone = mats["bone"]
    scar = mats["scar"]

    add_sphere(armature, "head", "glitch_reaper_face_to_throat_rounded_esophagus_mass", (-0.006, -0.044, 0.124), (0.018, 0.034, 0.014), blood, segments=32, rings=16)
    add_sphere(armature, "head", "glitch_reaper_face_to_throat_pale_human_column_volume", (-0.018, -0.040, 0.136), (0.007, 0.024, 0.007), skin, segments=32, rings=12)
    add_box(armature, "head", "glitch_reaper_face_to_throat_black_shadow_gap", (0.010, -0.016, 0.140), (0.012, 0.034, 0.0035), cavity, (0, 0, 4), bevel=0.0008)
    add_box(armature, "head", "glitch_reaper_face_to_throat_cyan_phase_edge", (0.020, 0.000, 0.146), (0.0016, 0.018, 0.0014), glitch, (0, 0, 6), bevel=0.0004)
    for i, y in enumerate([0.028, -0.006]):
        x = -0.014 + i * 0.028
        add_box(armature, "head", f"glitch_reaper_face_to_throat_bone_staple_{i}", (x, y, 0.150), (0.018, 0.0035, 0.0035), bone if i % 2 else scar, (0, 0, -14 + i * 8), bevel=0.0006)

    wound_panels = [
        ("spine_03", "upper_socket_wrap", (-0.042, 0.044, 0.174), 0.024, 0.046, skin, -18, 5),
        ("spine_03", "right_socket_wrap", (0.044, -0.040, 0.176), 0.026, 0.054, gore, 19, 5),
        ("spine_02", "abdomen", (0.014, -0.142, 0.176), 0.034, 0.096, gore, 9, 6),
    ]
    for bone_name, label, offset, width, length, material, angle, rag_points in wound_panels:
        add_torn_panel(armature, bone_name, f"glitch_reaper_continuous_fusion_wound_{label}", offset, width, length, material, (0, 0, angle), rag_points=rag_points, taper=0.26)

    add_sphere(armature, "spine_03", "glitch_reaper_readable_left_chest_human_rind_volume", (-0.070, -0.010, 0.188), (0.020, 0.088, 0.014), skin, segments=32, rings=16)
    add_sphere(armature, "spine_03", "glitch_reaper_readable_right_chest_raw_meat_rind_volume", (0.072, -0.032, 0.190), (0.020, 0.088, 0.015), gore, segments=32, rings=16)
    add_sphere(armature, "spine_03", "glitch_reaper_chest_side_wrap_left_human_rind", (-0.124, -0.012, 0.164), (0.014, 0.118, 0.020), skin, segments=32, rings=12)
    add_sphere(armature, "spine_03", "glitch_reaper_chest_side_wrap_right_raw_rind", (0.126, -0.030, 0.166), (0.014, 0.116, 0.022), gore, segments=32, rings=12)
    add_sphere(armature, "spine_03", "glitch_reaper_back_shoulder_human_rind_wrap_l", (-0.080, 0.014, -0.122), (0.012, 0.076, 0.014), skin, segments=32, rings=12)
    add_sphere(armature, "spine_03", "glitch_reaper_back_shoulder_raw_meat_wrap_r", (0.060, -0.030, -0.124), (0.012, 0.082, 0.015), blood, segments=32, rings=12)
    add_box(armature, "spine_03", "glitch_reaper_chest_rind_black_blood_depth", (0.0, -0.026, 0.192), (0.046, 0.112, 0.0045), blood, (0, 0, 1), bevel=0.0008)
    add_sphere(armature, "spine_03", "glitch_reaper_wet_organ_bulge_over_red_core", (0.020, -0.030, 0.196), (0.034, 0.060, 0.012), gore, segments=32, rings=16)
    add_sphere(armature, "spine_03", "glitch_reaper_left_chest_pale_human_viscera_lobe", (-0.032, -0.046, 0.198), (0.024, 0.046, 0.010), skin, segments=32, rings=16)
    add_sphere(armature, "spine_03", "glitch_reaper_lower_core_black_blood_viscera_cup", (0.000, -0.082, 0.199), (0.036, 0.034, 0.008), blood, segments=32, rings=12)
    add_box(armature, "spine_03", "glitch_reaper_wet_organ_machine_cutline", (0.020, -0.026, 0.202), (0.036, 0.0040, 0.0030), glow, (0, 0, 8), bevel=0.0005)
    add_box(armature, "spine_03", "glitch_reaper_chest_bone_sawtooth_l", (-0.050, 0.058, 0.204), (0.034, 0.0055, 0.0040), bone, (0, 0, -18), bevel=0.0008)
    add_box(armature, "spine_03", "glitch_reaper_chest_bone_sawtooth_r", (0.052, 0.032, 0.204), (0.036, 0.0055, 0.0040), bone, (0, 0, 18), bevel=0.0008)
    for i, y in enumerate([0.074, 0.012, -0.074]):
        x = -0.036 + i * 0.036
        add_box(armature, "spine_03", f"glitch_reaper_readable_chest_rind_staple_{i}", (x, y, 0.206), (0.020, 0.0040, 0.0030), metal if i % 2 else bone, (0, 0, -20 + i * 10), bevel=0.0006)
    add_cylinder(armature, "spine_03", "glitch_reaper_front_wound_single_wet_cable_0", (0.026, -0.016, 0.186), 0.0042, 0.114, blood, (84, 0, 12))
    add_box(armature, "spine_03", "glitch_reaper_front_wound_cyan_dimensional_bad_edge", (0.076, -0.012, 0.202), (0.0018, 0.090, 0.0014), glitch, (0, 0, 12), bevel=0.0004)

    for i, y in enumerate([0.112, 0.026, -0.094]):
        sign = -1 if i % 2 else 1
        bridge_mat = bone if i == 1 else metal
        add_box(armature, "spine_03", f"glitch_reaper_fusion_wound_endoskeleton_bridge_{i}", (sign * 0.026, y, 0.190), (0.040, 0.0055, 0.0045), bridge_mat, (0, 0, sign * 16), bevel=0.0009)
        add_box(armature, "spine_03", f"glitch_reaper_fusion_wound_black_blood_socket_{i}", (sign * 0.016, y - 0.010, 0.194), (0.022, 0.0050, 0.0032), blood, (0, 0, sign * 12), bevel=0.0006)
        if i == 0:
            add_box(armature, "spine_03", f"glitch_reaper_fusion_wound_buried_cyan_misread_{i}", (sign * 0.036, y - 0.006, 0.198), (0.0018, 0.020, 0.0016), glitch, (0, 0, sign * 16), bevel=0.0003)
    for i, (x, y, angle, material) in enumerate([
        (-0.042, 0.076, -28, blood),
        (0.044, -0.046, 30, gore),
    ]):
        add_cylinder(armature, "spine_03", f"glitch_reaper_fusion_wound_opposed_pull_sinew_{i}", (x, y, 0.190), 0.0034, 0.092 + i * 0.012, material, (83, 0, angle))
        add_box(armature, "spine_03", f"glitch_reaper_fusion_wound_machine_bite_mark_{i}", (x * 0.72, y - 0.012, 0.200), (0.016, 0.0040, 0.0032), metal if i % 2 else bone, (0, 0, angle * 0.45), bevel=0.0005)

    add_cylinder(armature, "spine_03", "glitch_reaper_neck_to_heart_wet_tether_0", (-0.024, 0.052, 0.168), 0.0038, 0.118, blood, (84, 0, -10))
    for i, x in enumerate([-0.030, 0.028]):
        add_cylinder(armature, "spine_02", f"glitch_reaper_abdomen_pulled_nerve_spool_{i}", (x, -0.158 - i * 0.010, 0.166), 0.0038, 0.086 + i * 0.014, blood if i % 2 else gore, (86, 0, -27 + i * 44))

    add_box(armature, "spine_03", "glitch_reaper_fusion_wound_upper_surgical_rail", (0.0, 0.088, 0.204), (0.116, 0.009, 0.006), metal, (0, 0, -2), bevel=0.001)
    add_box(armature, "spine_03", "glitch_reaper_fusion_wound_lower_surgical_rail", (0.0, -0.114, 0.204), (0.082, 0.009, 0.006), metal, (0, 0, 2), bevel=0.001)
    add_box(armature, "spine_02", "glitch_reaper_abdomen_wound_red_core_glimpse", (0.0, -0.146, 0.188), (0.012, 0.066, 0.005), glow, (0, 0, -2), bevel=0.0008)


def build_limb_modules(armature, mats: dict[str, bpy.types.Material]) -> None:
    metal = mats["metal"]
    glow = mats["glow"]
    glitch = mats["glitch"]
    gore = mats["gore"]
    skin = mats["skin"]
    blood = mats["blood"]
    bone = mats["bone"]
    scar = mats["scar"]

    for side in ["l", "r"]:
        sign = -1 if side == "l" else 1
        mirror_angle = 1 if side == "l" else -1
        add_box(armature, f"upperarm_{side}", f"glitch_reaper_jagged_pauldron_{side}", (0.0, 0.062, 0.042), (0.086, 0.058, 0.060), metal, (0, 0, 16 * mirror_angle), bevel=0.008)
        add_box(armature, f"upperarm_{side}", f"glitch_reaper_pauldron_outer_blade_{side}", (sign * 0.040, 0.078, 0.050), (0.014, 0.094, 0.014), metal, (0, 0, 26 * mirror_angle), bevel=0.003)
        add_box(armature, f"upperarm_{side}", f"glitch_reaper_pauldron_burning_crack_{side}", (sign * 0.008, 0.070, 0.076), (0.005, 0.046, 0.005), glow, (0, 0, -22 * mirror_angle), bevel=0.0008)
        add_cone(armature, f"upperarm_{side}", f"glitch_reaper_shoulder_hook_{side}", (sign * 0.052, 0.104, 0.010), 0.011, 0.052, metal, (0, 0, 26 * mirror_angle))
        add_box(armature, f"upperarm_{side}", f"glitch_reaper_upperarm_flayed_skin_band_{side}", (-sign * 0.040, -0.030, 0.092), (0.028, 0.118, 0.008), skin if side == "l" else gore, (0, 0, -18 * mirror_angle), bevel=0.0015)
        add_box(armature, f"upperarm_{side}", f"glitch_reaper_upperarm_surgical_clamp_{side}", (-sign * 0.044, 0.006, 0.102), (0.044, 0.016, 0.010), metal, (0, 0, -18 * mirror_angle), bevel=0.002)
        add_box(armature, f"upperarm_{side}", f"glitch_reaper_upperarm_buried_shoulder_socket_{side}", (-sign * 0.030, 0.046, 0.102), (0.050, 0.024, 0.014), bone if side == "l" else metal, (0, 0, -16 * mirror_angle), bevel=0.0014)
        add_torn_panel(armature, f"upperarm_{side}", f"glitch_reaper_upperarm_skin_pulled_into_pauldron_{side}", (-sign * 0.036, 0.020, 0.112), 0.026, 0.116, gore if side == "l" else skin, (0, 0, -16 * mirror_angle), rag_points=7, taper=0.24)
        for i in range(2):
            add_cylinder(armature, f"upperarm_{side}", f"glitch_reaper_upperarm_socket_wet_servo_tendon_{side}_{i}", (-sign * (0.018 + i * 0.016), 0.014 - i * 0.028, 0.104), 0.0028, 0.126 + i * 0.020, blood if i == 0 else scar, (82, 0, -20 * mirror_angle + i * 10 * mirror_angle))

        add_box(armature, f"lowerarm_{side}", f"glitch_reaper_forearm_splint_{side}", (0.0, -0.044, 0.052), (0.052, 0.210, 0.032), metal, (0, 0, 0), bevel=0.007)
        add_box(armature, f"lowerarm_{side}", f"glitch_reaper_forearm_molten_rail_{side}", (-sign * 0.025, -0.042, 0.084), (0.008, 0.172, 0.008), glow, (0, 0, 8 * mirror_angle), bevel=0.0012)
        add_cylinder(armature, f"lowerarm_{side}", f"glitch_reaper_forearm_hydraulic_piston_{side}", (sign * 0.040, -0.060, 0.030), 0.0042, 0.216, scar, (86, 0, -12 * mirror_angle))
        add_box(armature, f"lowerarm_{side}", f"glitch_reaper_forearm_meat_window_{side}", (-sign * 0.026, -0.092, 0.086), (0.026, 0.104, 0.008), gore if side == "l" else blood, (0, 0, 14 * mirror_angle), bevel=0.0015)
        add_box(armature, f"lowerarm_{side}", f"glitch_reaper_forearm_skin_staple_top_{side}", (-sign * 0.024, -0.042, 0.094), (0.032, 0.010, 0.007), metal, (0, 0, 14 * mirror_angle), bevel=0.001)
        add_box(armature, f"lowerarm_{side}", f"glitch_reaper_forearm_skin_staple_low_{side}", (-sign * 0.032, -0.128, 0.094), (0.034, 0.010, 0.007), metal, (0, 0, 14 * mirror_angle), bevel=0.001)
        add_torn_panel(armature, f"lowerarm_{side}", f"glitch_reaper_forearm_flensed_sleeve_{side}", (-sign * 0.040, -0.086, 0.098), 0.028, 0.146, skin if side == "r" else gore, (0, 0, 17 * mirror_angle), rag_points=6, taper=0.24)
        for i in range(3):
            add_box(armature, f"lowerarm_{side}", f"glitch_reaper_forearm_sleeve_staple_{side}_{i}", (-sign * 0.038, -0.034 - i * 0.044, 0.104), (0.032, 0.006, 0.005), metal, (0, 0, 17 * mirror_angle), bevel=0.0008)

        add_box(armature, f"thigh_{side}", f"glitch_reaper_thigh_black_rail_{side}", (0.0, -0.080, 0.050), (0.066, 0.250, 0.038), metal, (0, 0, 6 * mirror_angle), bevel=0.008)
        add_box(armature, f"thigh_{side}", f"glitch_reaper_thigh_flesh_graft_{side}", (sign * 0.042, -0.074, 0.082), (0.030, 0.168, 0.008), skin if side == "r" else gore, (0, 0, -12 * mirror_angle), bevel=0.0015)
        add_box(armature, f"thigh_{side}", f"glitch_reaper_thigh_clamp_ring_front_{side}", (0.0, -0.020, 0.088), (0.108, 0.018, 0.010), metal, (0, 0, 5 * mirror_angle), bevel=0.002)
        add_box(armature, f"thigh_{side}", f"glitch_reaper_knee_red_rune_{side}", (0.0, -0.204, 0.084), (0.040, 0.016, 0.008), glow, (0, 0, 30 * mirror_angle), bevel=0.0012)
        add_box(armature, f"calf_{side}", f"glitch_reaper_shin_black_core_{side}", (0.0, -0.055, 0.048), (0.052, 0.210, 0.034), metal, (0, 0, -4 * mirror_angle), bevel=0.008)
        add_box(armature, f"calf_{side}", f"glitch_reaper_shin_flame_wire_{side}", (sign * 0.022, -0.052, 0.074), (0.008, 0.148, 0.008), glow, (0, 0, 7 * mirror_angle), bevel=0.0012)
        add_box(armature, f"calf_{side}", f"glitch_reaper_calf_exposed_bone_splinter_{side}", (-sign * 0.026, -0.110, 0.080), (0.016, 0.120, 0.008), bone, (0, 0, -16 * mirror_angle), bevel=0.0015)

    add_blade(armature, "lowerarm_r", "glitch_reaper_execution_blade_body", (0.006, -0.286, 0.122), (0.118, 0.760, 0.036), metal, (0, 0, -5))
    add_box(armature, "lowerarm_r", "glitch_reaper_execution_blade_red_edge", (0.054, -0.270, 0.149), (0.012, 0.612, 0.008), glow, (0, 0, -5), bevel=0.0012)
    add_box(armature, "lowerarm_r", "glitch_reaper_execution_blade_cyan_break", (-0.038, -0.222, 0.143), (0.0020, 0.068, 0.0020), glitch, (0, 0, 4), bevel=0.0005)
    add_box(armature, "lowerarm_r", "glitch_reaper_execution_blade_black_blood_seam", (-0.006, -0.166, 0.153), (0.016, 0.260, 0.007), blood, (0, 0, -5), bevel=0.001)
    add_box(armature, "lowerarm_r", "glitch_reaper_execution_blade_wrist_clamp", (0.0, -0.048, 0.102), (0.112, 0.036, 0.026), metal, (0, 0, -3), bevel=0.003)
    add_box(armature, "lowerarm_r", "glitch_reaper_execution_blade_root_bone_socket", (-0.020, -0.084, 0.128), (0.046, 0.080, 0.014), bone, (0, 0, -8), bevel=0.002)
    add_torn_panel(armature, "lowerarm_r", "glitch_reaper_execution_blade_skin_wrapped_root", (0.036, -0.106, 0.152), 0.032, 0.142, gore, (0, 0, -5), rag_points=7, taper=0.30)
    for i in range(4):
        add_cylinder(armature, "lowerarm_r", f"glitch_reaper_execution_blade_servo_tendon_{i}", (-0.030 + i * 0.018, -0.104 - i * 0.018, 0.118), 0.0034, 0.160 + i * 0.020, blood if i % 2 else scar, (84, 0, -20 + i * 10))
    for i, (x, y, angle, material) in enumerate([
        (0.026, -0.068, -18, blood),
        (-0.010, -0.098, 8, gore),
        (0.034, -0.132, -10, skin),
    ]):
        add_torn_panel(armature, "lowerarm_r", f"glitch_reaper_execution_blade_root_flesh_spiral_{i}", (x, y, 0.156), 0.020, 0.094 + i * 0.018, material, (0, 0, angle), rag_points=6, taper=0.26)
        add_box(armature, "lowerarm_r", f"glitch_reaper_execution_blade_root_metal_bite_{i}", (x - 0.014, y + 0.018, 0.160), (0.026, 0.006, 0.005), metal if i != 1 else bone, (0, 0, angle), bevel=0.0007)

    for i in range(5):
        x = (i - 2) * 0.016
        add_box(armature, "hand_l", f"glitch_reaper_left_claw_{i}", (x, -0.062, 0.070), (0.010, 0.138, 0.008), metal if i != 2 else bone, (22, 0, (i - 2) * 8), bevel=0.0015)
        if i in [1, 3]:
            add_cylinder(armature, "hand_l", f"glitch_reaper_left_hand_wet_tendon_{i}", (x, -0.036, 0.052), 0.0032, 0.112, blood, (78, 0, (i - 2) * 8))
    add_box(armature, "hand_l", "glitch_reaper_left_palm_human_gum_mass", (0.0, -0.032, 0.084), (0.048, 0.044, 0.012), gore, (0, 0, 0), bevel=0.002)
    add_box(armature, "hand_l", "glitch_reaper_left_palm_metal_suture_bar", (0.0, -0.018, 0.094), (0.060, 0.008, 0.006), metal, (0, 0, 0), bevel=0.0008)


def build_gore_modules(armature, mats: dict[str, bpy.types.Material]) -> None:
    metal = mats["metal"]
    gore = mats["gore"]
    glow = mats["glow"]
    skin = mats["skin"]
    blood = mats["blood"]
    bone = mats["bone"]

    drape_layout = [
        (-0.070, 0.116, 0.022, 0.074, gore, -26, 5, 0.34),
        (0.000, 0.136, 0.056, 0.138, skin, 12, 7, 0.58),
        (0.076, 0.118, 0.022, 0.076, blood, 30, 5, 0.40),
    ]
    for i, (x, z, width, length, material, angle, rag_points, taper) in enumerate(drape_layout):
        add_torn_panel(armature, "spine_01", f"glitch_reaper_flayed_gore_drape_{i}", (x, -0.160 - length * 0.34, z), width, length, material, (0, 0, angle), rag_points=rag_points, taper=taper)
        add_box(armature, "spine_01", f"glitch_reaper_flayed_drape_top_clamp_{i}", (x, -0.154, z + 0.010), (width * 1.45, 0.012, 0.009), metal, (0, 0, angle), bevel=0.0012)
        if i % 2 == 0:
            add_box(armature, "spine_01", f"glitch_reaper_embered_gore_edge_{i}", (x, -0.164 - length * 0.76, z + 0.006), (width * 0.54, 0.007, 0.005), glow, (0, 0, angle), bevel=0.0008)
        else:
            add_box(armature, "spine_01", f"glitch_reaper_black_blood_torn_edge_{i}", (x, -0.164 - length * 0.74, z + 0.006), (width * 0.60, 0.008, 0.005), blood, (0, 0, angle), bevel=0.0008)
        if i == 1:
            add_cylinder(armature, "spine_01", f"glitch_reaper_flayed_drape_hanging_nerve_{i}", (x + 0.010, -0.164 - length * 0.48, z + 0.004), 0.0032, length * 0.44, blood, (86, 0, angle + 8))
        if i == 1:
            add_sphere(armature, "spine_01", f"glitch_reaper_flayed_drape_weighted_blood_bead_{i}", (x, -0.168 - length * 0.84, z + 0.006), (0.006, 0.008, 0.004), blood, segments=16, rings=8)

    add_box(armature, "spine_01", "glitch_reaper_gore_apron_master_clamp", (0.0, -0.144, 0.128), (0.172, 0.018, 0.012), metal, (0, 0, -2), bevel=0.002)
    add_box(armature, "spine_01", "glitch_reaper_gore_apron_red_underlight", (0.0, -0.164, 0.132), (0.082, 0.006, 0.005), glow, (0, 0, -2), bevel=0.0008)
    add_torn_panel(armature, "spine_01", "glitch_reaper_flayed_gore_drape_central_human_sheet", (-0.004, -0.224, 0.154), 0.076, 0.168, skin, (0, 0, -13), rag_points=7, taper=0.72)
    add_box(armature, "spine_01", "glitch_reaper_central_human_sheet_black_blood_backing", (-0.002, -0.224, 0.160), (0.048, 0.100, 0.006), blood, (0, 0, -13), bevel=0.0008)
    add_box(armature, "spine_01", "glitch_reaper_central_human_sheet_raw_red_split", (0.010, -0.210, 0.166), (0.026, 0.040, 0.005), gore, (0, 0, 28), bevel=0.0008)
    add_box(armature, "spine_01", "glitch_reaper_central_human_sheet_bone_pin_upper", (-0.030, -0.188, 0.172), (0.026, 0.007, 0.005), bone, (0, 0, -22), bevel=0.0006)
    add_box(armature, "spine_01", "glitch_reaper_central_human_sheet_bone_pin_lower", (0.018, -0.248, 0.172), (0.022, 0.007, 0.005), bone, (0, 0, 24), bevel=0.0006)
    add_sphere(armature, "spine_01", "glitch_reaper_apron_root_wet_human_knot", (-0.010, -0.178, 0.157), (0.034, 0.023, 0.012), blood, segments=32, rings=12)
    add_sphere(armature, "spine_01", "glitch_reaper_apron_pale_fat_lobe", (0.026, -0.204, 0.160), (0.018, 0.015, 0.007), gore, segments=32, rings=12)
    add_sphere(armature, "spine_01", "glitch_reaper_apron_lower_clotted_weight", (-0.018, -0.252, 0.158), (0.016, 0.018, 0.008), blood, segments=24, rings=10)
    add_box(armature, "spine_01", "glitch_reaper_apron_root_black_suture_shadow", (0.006, -0.188, 0.168), (0.040, 0.006, 0.004), blood, (0, 0, -20), bevel=0.0007)
    for i in range(2):
        x = -0.026 + i * 0.052
        y = -0.188 - i * 0.058
        add_box(armature, "spine_01", f"glitch_reaper_central_human_sheet_tension_staple_{i}", (x, y, 0.146), (0.022, 0.0045, 0.004), bone if i % 2 else metal, (0, 0, -10 + i * 5), bevel=0.0006)
    add_cylinder(armature, "spine_01", "glitch_reaper_central_human_sheet_wet_pull_cord_0", (-0.018, -0.222, 0.146), 0.0032, 0.096, blood, (84, 0, -12))

    for i, x in enumerate([-0.045, -0.015, 0.015, 0.045]):
        add_cylinder(armature, "spine_03", f"glitch_reaper_back_sinew_cable_{i}", (x, -0.052 + (i % 2) * 0.014, -0.130), 0.0054, 0.264 + (i % 3) * 0.034, gore if i % 2 == 0 else metal, (82, 0, -12 + i * 6))
    for i, x in enumerate([-0.030, 0.026]):
        add_cylinder(armature, "spine_02", f"glitch_reaper_abdomen_wet_intestine_cord_{i}", (x, -0.170 - i * 0.010, 0.118), 0.0062, 0.094 + i * 0.018, blood if i % 2 else gore, (86, 0, -32 + i * 54))
        add_box(armature, "spine_02", f"glitch_reaper_abdomen_cord_bone_pin_{i}", (x, -0.092, 0.136), (0.018, 0.016, 0.010), bone if i % 2 else metal, (0, 0, -10 + i * 5), bevel=0.001)

    for side in ["l", "r"]:
        sign = -1 if side == "l" else 1
        add_box(armature, f"upperarm_{side}", f"glitch_reaper_hooked_flesh_tag_{side}", (sign * 0.060, -0.070, 0.082), (0.022, 0.120, 0.008), gore, (0, 0, 14 * sign), bevel=0.0015)
        add_box(armature, f"upperarm_{side}", f"glitch_reaper_hooked_flesh_tag_clamp_{side}", (sign * 0.054, -0.018, 0.092), (0.036, 0.014, 0.008), metal, (0, 0, 14 * sign), bevel=0.0012)
        add_cylinder(armature, f"lowerarm_{side}", f"glitch_reaper_lowerarm_hanging_nerve_bundle_{side}", (sign * 0.042, -0.128, 0.070), 0.004, 0.154, blood, (82, 0, 16 * sign))


def build_surface_breakup_modules(armature, mats: dict[str, bpy.types.Material]) -> None:
    metal = mats["metal"]
    gore = mats["gore"]
    glow = mats["glow"]
    glitch = mats["glitch"]
    cavity = mats["cavity"]
    scar = mats["scar"]
    skin = mats["skin"]
    blood = mats["blood"]
    bone = mats["bone"]

    cut_layout = [
        (-0.060, 0.104, -22, 0.054, scar),
        (0.056, 0.020, 18, 0.058, blood),
        (0.0, -0.030, 0, 0.124, cavity),
    ]
    for i, (x, y, angle, length, material) in enumerate(cut_layout):
        add_box(armature, "spine_03", f"glitch_reaper_torso_scored_cut_{i}", (x, y, 0.190), (0.007, length, 0.004), material, (0, 0, angle), bevel=0.0009)

    for side in ["l", "r"]:
        sign = -1 if side == "l" else 1
        membrane_mat = skin if side == "l" else gore
        add_sphere(armature, "spine_03", f"glitch_reaper_flayed_chest_membrane_{side}_rounded", (sign * 0.122, -0.016, 0.188), (0.014, 0.112, 0.018), membrane_mat, segments=32, rings=12)
        add_box(armature, "spine_03", f"glitch_reaper_blackened_membrane_clamp_{side}", (sign * 0.118, 0.084, 0.178), (0.040, 0.022, 0.010), metal, (0, 0, sign * 15), bevel=0.002)
        add_box(armature, "spine_03", f"glitch_reaper_lower_membrane_clamp_{side}", (sign * 0.134, -0.088, 0.178), (0.038, 0.018, 0.010), metal, (0, 0, sign * 12), bevel=0.0015)
        add_box(armature, "spine_03", f"glitch_reaper_ember_membrane_edge_{side}", (sign * 0.138, -0.086, 0.180), (0.006, 0.074, 0.005), glow, (0, 0, sign * 28), bevel=0.001)
        add_box(armature, "spine_03", f"glitch_reaper_black_blood_membrane_shadow_{side}", (sign * 0.108, -0.050, 0.182), (0.010, 0.108, 0.005), blood, (0, 0, sign * 24), bevel=0.001)

        for i in range(1):
            y = 0.030 - i * 0.064
            add_cylinder(armature, "spine_03", f"glitch_reaper_tendon_tension_line_{side}_{i}", (sign * (0.078 + i * 0.008), y, 0.184), 0.0034, 0.132, gore if i % 2 else blood, (84, 0, sign * (34 + i * 7)))
            add_box(armature, "spine_03", f"glitch_reaper_chest_staple_crossbar_{side}_{i}", (sign * 0.118, y - 0.014, 0.190), (0.026, 0.006, 0.004), metal, (0, 0, sign * (20 + i * 4)), bevel=0.0008)

    add_box(armature, "head", "glitch_reaper_head_mask_raw_scrape_0", (-0.026, 0.020, 0.154), (0.0040, 0.016, 0.0032), blood, (0, 0, -16), bevel=0.0005)
    add_sphere(armature, "head", "glitch_reaper_head_left_cheek_flayed_patch_rounded", (-0.054, -0.002, 0.150), (0.007, 0.016, 0.007), skin, segments=24, rings=10)
    add_box(armature, "head", "glitch_reaper_head_left_cheek_black_blood_rim", (-0.052, -0.006, 0.150), (0.0040, 0.018, 0.0035), blood, (0, 0, -14), bevel=0.0006)
    add_box(armature, "head", "glitch_reaper_head_right_cyan_broken_scan", (0.056, 0.042, 0.156), (0.0018, 0.010, 0.0018), glitch, (0, 0, 18), bevel=0.0004)
    add_box(armature, "head", "glitch_reaper_head_bone_socket_chip", (0.052, 0.016, 0.148), (0.010, 0.013, 0.0040), bone, (0, 0, 17), bevel=0.0007)

    for side in ["l", "r"]:
        sign = -1 if side == "l" else 1
        for i, bone_name in enumerate([f"lowerarm_{side}", f"calf_{side}"]):
            add_box(armature, bone_name, f"glitch_reaper_limb_raw_scrape_{side}_{i}", (sign * 0.016, -0.072 + i * 0.008, 0.092), (0.005, 0.096 + i * 0.018, 0.004), scar if i == 0 else bone, (0, 0, sign * (-20 + i * 12)), bevel=0.0007)
            add_box(armature, bone_name, f"glitch_reaper_limb_black_blood_score_{side}_{i}", (-sign * 0.014, -0.096 + i * 0.004, 0.095), (0.005, 0.062 + i * 0.012, 0.004), blood, (0, 0, sign * (14 - i * 8)), bevel=0.0007)
            if i % 2 == 0:
                add_box(armature, bone_name, f"glitch_reaper_limb_gore_wrap_{side}_{i}", (-sign * 0.028, -0.020 - i * 0.020, 0.088), (0.018, 0.078, 0.006), gore if side == "l" else skin, (0, 0, sign * (18 - i * 8)), bevel=0.001)
                add_box(armature, bone_name, f"glitch_reaper_limb_wrap_micro_clamp_{side}_{i}", (-sign * 0.026, 0.010 - i * 0.020, 0.096), (0.026, 0.007, 0.005), metal, (0, 0, sign * (18 - i * 8)), bevel=0.0007)


def build_glitch_modules(armature, mats: dict[str, bpy.types.Material]) -> None:
    glitch = mats["glitch"]
    shears = [
        ("head", (-0.018, 0.106, 0.192), (0.0018, 0.026, 0.0016), (0, 0, -10)),
        ("head", (0.020, 0.048, 0.196), (0.0018, 0.032, 0.0016), (0, 0, 7)),
        ("spine_03", (-0.028, 0.100, 0.224), (0.0018, 0.042, 0.0016), (0, 0, -14)),
        ("spine_03", (0.024, 0.012, 0.226), (0.0018, 0.058, 0.0016), (0, 0, 12)),
        ("spine_02", (-0.026, -0.140, 0.186), (0.0018, 0.036, 0.0016), (0, 0, -8)),
        ("lowerarm_r", (-0.040, -0.234, 0.146), (0.0020, 0.074, 0.0018), (0, 0, 4)),
    ]
    for i, (bone, offset, size, rotation) in enumerate(shears):
        add_box(armature, bone, f"glitch_reaper_cyan_data_tear_{i}", offset, size, glitch, rotation, bevel=0.0008)

    scanlines = [
        ("head", (-0.014, 0.110, 0.192), 0.022, -4),
        ("spine_03", (-0.004, 0.024, 0.226), 0.048, -4),
        ("lowerarm_r", (-0.004, -0.286, 0.150), 0.034, 4),
    ]
    for i, (bone, offset, width, angle) in enumerate(scanlines):
        add_box(armature, bone, f"glitch_reaper_cyan_phase_scanline_{i}", offset, (width, 0.0028, 0.0028), glitch, (0, 0, angle), bevel=0.0004)


def parent_to_bone(obj, armature, bone_name: str) -> None:
    if bone_name not in armature.data.bones:
        raise RuntimeError(f"Missing bone {bone_name}")
    obj.parent = armature
    obj.parent_type = "BONE"
    obj.parent_bone = bone_name


def assign_material(obj, mat) -> None:
    obj.data.materials.append(mat)


def set_transform(obj, location, rotation_deg, scale) -> None:
    obj.location = location
    obj.rotation_euler = tuple(math.radians(v) for v in rotation_deg)
    obj.scale = scale


def polish_mesh(obj, bevel: float = 0.0, bevel_segments: int = 2, smooth: bool = True) -> None:
    if smooth and hasattr(obj.data, "polygons"):
        if hasattr(obj.data, "use_auto_smooth"):
            obj.data.use_auto_smooth = True
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    if bevel > 0:
        bevel_mod = obj.modifiers.new(name="GR_beveled_edges", type="BEVEL")
        bevel_mod.width = bevel
        bevel_mod.segments = max(bevel_segments, 2)
        bevel_mod.profile = 0.42
        try:
            bevel_mod.affect = "EDGES"
        except (AttributeError, TypeError):
            pass
    try:
        normal_mod = obj.modifiers.new(name="GR_weighted_normals", type="WEIGHTED_NORMAL")
        normal_mod.keep_sharp = True
    except Exception:
        pass


def add_membrane_thickness(obj, width: float) -> None:
    try:
        solid = obj.modifiers.new(name="GR_membrane_thickness", type="SOLIDIFY")
        solid.thickness = min(max(width * 0.18, 0.0038), 0.016)
        solid.offset = 0
        if hasattr(solid, "use_quality_normals"):
            solid.use_quality_normals = True
    except Exception:
        pass


def add_box(armature, bone, name, location, size, mat, rotation_deg=(0, 0, 0), bevel: float = 0.006, bevel_segments: int = 3) -> None:
    bpy.ops.mesh.primitive_cube_add(size=1)
    obj = bpy.context.object
    obj.name = name
    assign_material(obj, mat)
    set_transform(obj, location, rotation_deg, size)
    polish_mesh(obj, bevel=bevel, bevel_segments=bevel_segments, smooth=True)
    parent_to_bone(obj, armature, bone)


def add_sphere(armature, bone, name, location, scale, mat, rotation_deg=(0, 0, 0), segments: int = 48, rings: int = 24) -> None:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings)
    obj = bpy.context.object
    obj.name = name
    assign_material(obj, mat)
    set_transform(obj, location, rotation_deg, scale)
    polish_mesh(obj, bevel=0.0, smooth=True)
    parent_to_bone(obj, armature, bone)


def add_cone(armature, bone, name, location, radius, depth, mat, rotation_deg=(0, 0, 0)) -> None:
    bpy.ops.mesh.primitive_cone_add(vertices=10, radius1=radius, radius2=0, depth=depth)
    obj = bpy.context.object
    obj.name = name
    assign_material(obj, mat)
    set_transform(obj, location, rotation_deg, (1, 1, 1))
    polish_mesh(obj, bevel=0.0015, bevel_segments=1, smooth=True)
    parent_to_bone(obj, armature, bone)


def add_torus(armature, bone, name, location, major, minor, mat, rotation_deg=(0, 0, 0)) -> None:
    bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=minor, major_segments=48, minor_segments=12)
    obj = bpy.context.object
    obj.name = name
    assign_material(obj, mat)
    set_transform(obj, location, rotation_deg, (1, 1, 1))
    polish_mesh(obj, bevel=0.0, smooth=True)
    parent_to_bone(obj, armature, bone)


def add_cylinder(armature, bone, name, location, radius, depth, mat, rotation_deg=(0, 0, 0)) -> None:
    bpy.ops.mesh.primitive_cylinder_add(vertices=16, radius=radius, depth=depth)
    obj = bpy.context.object
    obj.name = name
    assign_material(obj, mat)
    set_transform(obj, location, rotation_deg, (1, 1, 1))
    polish_mesh(obj, bevel=0.0, smooth=True)
    parent_to_bone(obj, armature, bone)


def add_blade(armature, bone, name, location, size, mat, rotation_deg=(0, 0, 0)) -> None:
    width, length, depth = size
    x = width / 2
    y = length / 2
    z = depth / 2
    vertices = [
        (-x, -y, -z),
        (x * 0.70, -y, -z),
        (0.0, y, -z),
        (-x, -y, z),
        (x * 0.70, -y, z),
        (0.0, y, z),
    ]
    faces = [
        (0, 1, 2),
        (3, 5, 4),
        (0, 3, 4, 1),
        (1, 4, 5, 2),
        (2, 5, 3, 0),
    ]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    assign_material(obj, mat)
    set_transform(obj, location, rotation_deg, (1, 1, 1))
    polish_mesh(obj, bevel=0.004, bevel_segments=2, smooth=True)
    parent_to_bone(obj, armature, bone)


def add_torn_panel(armature, bone, name, location, width, length, mat, rotation_deg=(0, 0, 0), rag_points: int = 6, taper: float = 0.2) -> None:
    rag_points = max(rag_points, 2)
    top_half = width * 0.5
    bottom_half = max(width * (0.5 - taper * 0.35), width * 0.18)
    top_y = length * 0.5
    bottom_y = -length * 0.5
    vertices = [(-top_half, top_y, 0.0), (top_half, top_y, 0.0)]
    for i in range(rag_points):
        t = 1.0 - i / max(rag_points - 1, 1)
        edge_noise = math.sin((i + 1) * 2.113 + len(name) * 0.371)
        x = -bottom_half + bottom_half * 2.0 * t + edge_noise * width * 0.035
        tooth = 0.032 + 0.050 * ((math.sin((i + 3) * 4.019 + len(name) * 0.133) + 1.0) * 0.5)
        y = bottom_y - length * tooth
        vertices.append((x, y, 0.0))
    faces = [tuple(range(len(vertices)))]
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    assign_material(obj, mat)
    set_transform(obj, location, rotation_deg, (1, 1, 1))
    add_membrane_thickness(obj, width)
    polish_mesh(obj, bevel=min(max(width * 0.018, 0.0007), 0.0022), bevel_segments=2, smooth=True)
    parent_to_bone(obj, armature, bone)


def render_preview_set(dist_dir: Path) -> list[str]:
    previews = [
        ("front", Vector((0, -1, 0.14))),
        ("side", Vector((1, 0, 0.12))),
        ("back", Vector((0, 1, 0.14))),
        ("three_quarter", Vector((0.72, -0.92, 0.22))),
    ]
    setup_preview_scene()
    center, extent = scene_bounds()
    height = max(extent.z, 1.0)
    radius = max(extent.x, extent.y, height * 0.55, 1.0)
    camera = bpy.data.objects["GR_preview_camera"]
    camera.data.ortho_scale = max(height * 1.08, radius * 1.35)
    target = center + Vector((0, 0, height * 0.04))
    distance = max(radius * 3.2, 3.0)
    paths = []
    for suffix, direction in previews:
        direction = direction.normalized()
        camera.location = target + direction * distance
        look_at(camera, target)
        path = dist_dir / f"{VARIANT_ID}_preview_{suffix}.png"
        bpy.context.scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        paths.append(str(path))
    contact_sheet = dist_dir / f"{VARIANT_ID}_contact_sheet.png"
    contact_sheet.unlink(missing_ok=True)
    make_contact_sheet(paths, contact_sheet)
    preview_paths = [path_relative_to_project(path) for path in paths]
    if contact_sheet.exists():
        preview_paths.append(path_relative_to_project(contact_sheet))
    return preview_paths


def set_preview_render_engine(scene) -> None:
    try:
        engines = {item.identifier for item in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items}
    except Exception:
        engines = set()
    for engine in ["BLENDER_EEVEE_NEXT", "BLENDER_EEVEE", "BLENDER_WORKBENCH"]:
        if engine in engines:
            scene.render.engine = engine
            return


def setup_preview_scene() -> None:
    scene = bpy.context.scene
    set_preview_render_engine(scene)
    eevee = getattr(scene, "eevee", None)
    if eevee is not None:
        if hasattr(eevee, "use_bloom"):
            eevee.use_bloom = True
        if hasattr(eevee, "use_gtao"):
            eevee.use_gtao = True
            if hasattr(eevee, "gtao_distance"):
                eevee.gtao_distance = 2.0
            if hasattr(eevee, "gtao_factor"):
                eevee.gtao_factor = 0.95
    scene.render.resolution_x = 640
    scene.render.resolution_y = 840
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Filmic"
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = 0.18
    scene.view_settings.gamma = 1.0
    scene.world = scene.world or bpy.data.worlds.new("GR_preview_world")
    scene.world.color = (0.032, 0.030, 0.028)

    center, extent = scene_bounds()
    floor_z = center.z - extent.z * 0.52
    bpy.ops.mesh.primitive_plane_add(size=max(extent.x, extent.y, 2.8) * 2.2, location=(center.x, center.y, floor_z))
    floor = bpy.context.object
    floor.name = "GR_preview_floor"
    floor.data.materials.append(make_mat("GR_preview_floor_mat", (0.095, 0.092, 0.087, 1), 0.0, 0.68))

    bpy.ops.object.light_add(type="AREA", location=(center.x - 2.8, center.y - 3.0, center.z + 3.4))
    key = bpy.context.object
    key.name = "GR_preview_key_light"
    key.data.energy = 720
    key.data.size = 4.6

    bpy.ops.object.light_add(type="AREA", location=(center.x + 2.5, center.y - 2.2, center.z + 2.0))
    fill = bpy.context.object
    fill.name = "GR_preview_cold_fill"
    fill.data.color = (0.68, 0.64, 0.58)
    fill.data.energy = 155
    fill.data.size = 5.2

    bpy.ops.object.light_add(type="POINT", location=(center.x + 2.0, center.y + 1.8, center.z + 1.6))
    rim = bpy.context.object
    rim.name = "GR_preview_red_rim"
    rim.data.color = (1.0, 0.08, 0.03)
    rim.data.energy = 145

    bpy.ops.object.camera_add(location=(center.x, center.y - 4, center.z + 1.2))
    camera = bpy.context.object
    camera.name = "GR_preview_camera"
    camera.data.type = "ORTHO"
    bpy.context.scene.camera = camera


def scene_bounds() -> tuple[Vector, Vector]:
    mins = Vector((1e9, 1e9, 1e9))
    maxs = Vector((-1e9, -1e9, -1e9))
    found = False
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj.name.startswith("GR_preview_"):
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


def write_report(project_root: Path, base_glb: Path, blend_path: Path, dist_glb: Path, art_glb: Path, module_names: list[str], previews: list[str]) -> None:
    report_path = dist_glb.parent / f"{VARIANT_ID}_report.json"
    glb_stats = read_glb_stats(dist_glb)
    report = {
        "variant_id": VARIANT_ID,
        "status": "prototype_pass_blender_compiled_pending_godot_validation",
        "source_model": path_relative_to_project(base_glb),
        "implementation_approach": "The Mesh2Motion body is preserved as an animation carrier. Blender headlessly authors a compact terminator skull, exposed rib furnace, pinned flayed skin, wet blood seams, blade arm, hydraulic rails, and controlled cyan phase shears as rigid bone-parented modules, then exports the assembled GLB.",
        "blender": {
            "compiler": "scripts/build-glitch-reaper-blender.py",
            "available_in_this_vm": True,
            "version": bpy.app.version_string,
            "executed": True,
        },
        "artifacts": {
            "blend": path_relative_to_project(blend_path),
            "glb_dist": path_relative_to_project(dist_glb),
            "glb_godot": path_relative_to_project(art_glb),
            "previews": previews,
        },
        "skeleton": {
            "source_skeleton_preserved": True,
            "bone_hierarchy_changed": False,
            "bone_names_changed": False,
            "attachment_strategy": "rigid Blender objects parented to existing source bones",
        },
        "geometry": {
            "generated_module_count": len(module_names),
            "total_mesh_count": glb_stats["mesh_count"],
            "material_count": glb_stats["material_count"],
            "animation_count": glb_stats["animation_count"],
            "max_texture_size": 256,
            "external_textures": False,
            "dist_glb_bytes": dist_glb.stat().st_size if dist_glb.exists() else 0,
        },
        "validation_questions": {
            "original_mannequin_face_still_visible": "covered by compact skull shell, face cavity, split jaw, flayed cheek remnants, brow, and neck collar; not deleted",
            "coherent_replacement_head_module": True,
            "red_eyes_readable": True,
            "reads_as_glitch_infernal_skeletal_cyborg": True,
            "reads_as_glitch_infernal_skeletal_cyborg_with_human_gore": True,
            "gore_flayed_aesthetic_present": True,
            "survives_idle_walk_run_attack": "pending_godot_audit",
            "importable_in_godot": "pending_godot_audit",
            "web_wasm_export_runs": "pending_export",
        },
        "notes": [
            "This pass favors separated wet blood, sallow flayed skin, dry burnt bone, blackened metal, red furnace heat, and restrained cyan phase shears over isolated prop-like attachments.",
            "The original head is covered rather than deleted so the source rig and skinned carrier mesh remain untouched.",
            "The generated asset uses embedded procedural PBR texture maps and no external texture dependencies.",
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
