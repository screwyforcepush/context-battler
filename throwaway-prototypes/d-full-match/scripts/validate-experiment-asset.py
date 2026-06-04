#!/usr/bin/env python3
"""Fast standalone validation for the experiment/Reallusion character asset."""

from __future__ import annotations

import argparse
import json
import struct
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


APP_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_GLB = APP_ROOT / "shared-harness/art-kit/characters/generated/experiment.glb"
DEFAULT_REPORT = APP_ROOT / "dist/characters/experiment/experiment_report.json"

JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942
EXPECTED_PARTS = (
    "experiment_reallusion_integrated_head",
    "experiment_reallusion_eyes",
    "experiment_reallusion_teeth",
    "experiment_reallusion_tongue",
)
FORBIDDEN_NAME_TOKENS = (
    "face_prop",
    "face-prop",
    "face prop",
    "eye_prop",
    "eye-prop",
    "eye prop",
    "jaw_prop",
    "jaw-prop",
    "jaw prop",
    "mouth_prop",
    "mouth-prop",
    "mouth prop",
    "face_sticker",
    "face-sticker",
    "sticker",
    "decal",
    "floating_plate",
    "floating-plate",
)


@dataclass
class Check:
    name: str
    passed: bool
    detail: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate the experiment Reallusion GLB/report pair.",
    )
    parser.add_argument(
        "--glb",
        type=Path,
        default=DEFAULT_GLB,
        help=f"GLB to validate. Default: {relative(DEFAULT_GLB)}",
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=DEFAULT_REPORT,
        help=f"Builder report JSON. Default: {relative(DEFAULT_REPORT)}",
    )
    parser.add_argument("--min-animations", type=int, default=80)
    parser.add_argument("--max-meshes", type=int, default=6)
    parser.add_argument("--max-materials", type=int, default=26)
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print a machine-readable validation summary.",
    )
    return parser.parse_args()


def relative(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(APP_ROOT))
    except ValueError:
        return str(path)


def load_report(path: Path) -> tuple[dict[str, Any], list[str]]:
    if not path.exists():
        return {}, [f"report missing: {relative(path)}"]
    try:
        return json.loads(path.read_text(encoding="utf-8")), []
    except json.JSONDecodeError as exc:
        return {}, [f"report JSON parse failed: {exc}"]


def load_glb_json(path: Path) -> tuple[dict[str, Any], dict[str, Any], list[str]]:
    if not path.exists():
        return {}, {}, [f"GLB missing: {relative(path)}"]

    data = path.read_bytes()
    errors: list[str] = []
    meta: dict[str, Any] = {"path": relative(path), "byte_length": len(data)}

    if len(data) < 20:
        return {}, meta, ["GLB is shorter than the required 20-byte header/chunk prefix"]

    magic, version, declared_length = struct.unpack_from("<4sII", data, 0)
    meta.update(
        {
            "magic": magic.decode("ascii", errors="replace"),
            "version": version,
            "declared_length": declared_length,
        }
    )

    if magic != b"glTF":
        errors.append(f"bad GLB magic: {magic!r}")
    if version != 2:
        errors.append(f"unsupported GLB version: {version}")
    if declared_length != len(data):
        errors.append(f"declared length {declared_length} != file length {len(data)}")

    offset = 12
    chunks: list[dict[str, Any]] = []
    gltf_json: dict[str, Any] | None = None
    while offset + 8 <= len(data):
        chunk_length, chunk_type = struct.unpack_from("<II", data, offset)
        offset += 8
        chunk_end = offset + chunk_length
        if chunk_end > len(data):
            errors.append(
                f"chunk at byte {offset - 8} overruns file: end {chunk_end}, file {len(data)}"
            )
            break
        chunk_data = data[offset:chunk_end]
        chunks.append({"type": chunk_type_name(chunk_type), "length": chunk_length})
        if gltf_json is None and chunk_type == JSON_CHUNK:
            try:
                gltf_json = json.loads(chunk_data.rstrip(b" \t\r\n\0").decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as exc:
                errors.append(f"JSON chunk parse failed: {exc}")
        offset = chunk_end

    if offset != len(data):
        errors.append(f"GLB chunk walk ended at {offset}, file length is {len(data)}")
    if not chunks:
        errors.append("GLB has no chunks")
    elif chunks[0]["type"] != "JSON":
        errors.append(f"first GLB chunk is {chunks[0]['type']}, expected JSON")
    if gltf_json is None:
        errors.append("GLB JSON chunk missing")

    meta["chunks"] = chunks
    return gltf_json or {}, meta, errors


def chunk_type_name(chunk_type: int) -> str:
    if chunk_type == JSON_CHUNK:
        return "JSON"
    if chunk_type == BIN_CHUNK:
        return "BIN"
    try:
        return struct.pack("<I", chunk_type).decode("ascii")
    except UnicodeDecodeError:
        return f"0x{chunk_type:08x}"


def names_from_gltf(gltf: dict[str, Any]) -> list[str]:
    names: list[str] = []
    for key in ("nodes", "meshes", "materials", "skins", "animations", "images", "textures"):
        for item in gltf.get(key, []) or []:
            name = item.get("name") if isinstance(item, dict) else None
            if name:
                names.append(str(name))
    return names


def gltf_stats(gltf: dict[str, Any]) -> dict[str, int]:
    return {
        "mesh_count": len(gltf.get("meshes", []) or []),
        "material_count": len(gltf.get("materials", []) or []),
        "animation_count": len(gltf.get("animations", []) or []),
        "node_count": len(gltf.get("nodes", []) or []),
    }


def report_stats(report: dict[str, Any]) -> dict[str, Any]:
    geometry = report.get("geometry") or {}
    return {
        "mesh_count": geometry.get("total_mesh_count"),
        "material_count": geometry.get("material_count"),
        "animation_count": geometry.get("animation_count"),
        "external_textures": geometry.get("external_textures"),
    }


def head_has_vertex_color(gltf: dict[str, Any]) -> bool:
    for mesh in gltf.get("meshes", []) or []:
        mesh_name = str(mesh.get("name", "")).lower()
        if "integrated_head" not in mesh_name and "reallusion_head" not in mesh_name:
            continue
        for primitive in mesh.get("primitives", []) or []:
            attrs = primitive.get("attributes") or {}
            if any(str(name).startswith("COLOR_") for name in attrs):
                return True
    return False


def expected_parts_present(names: list[str]) -> dict[str, bool]:
    lowered = [name.lower() for name in names]
    return {
        part: any(part.lower() in name for name in lowered)
        for part in EXPECTED_PARTS
    }


def external_texture_refs(gltf: dict[str, Any]) -> list[str]:
    refs: list[str] = []
    for image in gltf.get("images", []) or []:
        if not isinstance(image, dict):
            continue
        uri = image.get("uri")
        if uri and not str(uri).startswith("data:"):
            refs.append(str(uri))
    return refs


def report_bool(report: dict[str, Any], *path: str) -> bool:
    node: Any = report
    for key in path:
        if not isinstance(node, dict) or key not in node:
            return False
        node = node[key]
    return bool(node)


def report_list(report: dict[str, Any], *path: str) -> list[Any]:
    node: Any = report
    for key in path:
        if not isinstance(node, dict) or key not in node:
            return []
        node = node[key]
    return node if isinstance(node, list) else []


def project_path(path_text: str) -> Path:
    path = Path(path_text)
    if path.is_absolute():
        return path
    return APP_ROOT / path


def validate_reported_mask_atlas(report: dict[str, Any]) -> dict[str, Any]:
    atlas = ((report.get("texture_masks") or {}).get("skin_mask_atlas") or {})
    if not isinstance(atlas, dict) or not atlas:
        return {
            "declared": False,
            "errors": ["texture_masks.skin_mask_atlas missing from report"],
        }

    path_text = atlas.get("path")
    expected_dimensions = atlas.get("dimensions")
    channel_convention = atlas.get("channel_convention") or {}
    summary: dict[str, Any] = {
        "declared": True,
        "path": path_text,
        "expected_dimensions": expected_dimensions,
        "channel_convention": channel_convention,
        "errors": [],
    }
    if not path_text:
        summary["errors"].append("atlas path missing")
        return summary

    path = project_path(str(path_text))
    summary["absolute_path"] = str(path)
    if not path.exists():
        summary["errors"].append(f"atlas file missing: {relative(path)}")
        return summary

    try:
        from PIL import Image
    except ImportError as exc:
        summary["errors"].append(f"Pillow unavailable for mask atlas validation: {exc}")
        return summary

    try:
        with Image.open(path) as image:
            extrema = image.getextrema()
            summary.update(
                {
                    "mode": image.mode,
                    "dimensions": list(image.size),
                    "channel_extrema": {
                        channel: extrema[index]
                        for index, channel in enumerate(("R", "G", "B", "A"))
                        if isinstance(extrema, tuple) and index < len(extrema)
                    },
                }
            )
    except Exception as exc:
        summary["errors"].append(f"atlas image read failed: {exc}")
        return summary

    if summary.get("mode") != "RGBA":
        summary["errors"].append(f"atlas mode {summary.get('mode')} != RGBA")
    if expected_dimensions not in ([512, 512], [1024, 1024]):
        summary["errors"].append(f"atlas dimensions in report are not 512 or 1024: {expected_dimensions}")
    if expected_dimensions and summary.get("dimensions") != expected_dimensions:
        summary["errors"].append(
            f"atlas dimensions {summary.get('dimensions')} != report {expected_dimensions}"
        )
    expected_channels = {"R", "G", "B", "A"}
    if set(channel_convention) != expected_channels:
        summary["errors"].append(f"channel convention keys {sorted(channel_convention)} != {sorted(expected_channels)}")

    channel_extrema = summary.get("channel_extrema") or {}
    blank_channels = [
        channel
        for channel in ("R", "G", "B", "A")
        if channel not in channel_extrema or channel_extrema[channel][0] == channel_extrema[channel][1]
    ]
    summary["blank_channels"] = blank_channels
    if blank_channels:
        summary["errors"].append(f"blank atlas channels: {blank_channels}")

    report_stats = atlas.get("channel_stats") or {}
    reported_blank = [
        channel
        for channel in ("R", "G", "B", "A")
        if not (report_stats.get(channel) or {}).get("nonblank")
    ]
    summary["reported_blank_channels"] = reported_blank
    if reported_blank:
        summary["errors"].append(f"report marks blank atlas channels: {reported_blank}")
    return summary


def build_checks(
    gltf: dict[str, Any],
    glb_meta: dict[str, Any],
    glb_errors: list[str],
    report: dict[str, Any],
    report_errors: list[str],
    min_animations: int,
    max_meshes: int,
    max_materials: int,
) -> tuple[list[Check], dict[str, Any]]:
    stats = gltf_stats(gltf)
    rstats = report_stats(report)
    names = names_from_gltf(gltf)
    forbidden_names = [
        name
        for name in names
        if any(token in name.lower() for token in FORBIDDEN_NAME_TOKENS)
    ]
    part_presence = expected_parts_present(names)
    face_intruders = report_list(report, "validation", "face_region_intruders")
    ext_refs = external_texture_refs(gltf)
    report_says_no_external = rstats.get("external_textures") is False
    counts_match = all(
        rstats[key] is None or rstats[key] == stats[key]
        for key in ("mesh_count", "material_count", "animation_count")
    )

    head_mask_report_present = (
        report_bool(report, "validation", "checks", "head_vertex_color_mask_present")
        or report_bool(report, "validation_questions", "head_region_vertex_color_mask_present")
    )
    eyes_teeth_tongue_report_present = (
        report_bool(report, "validation", "checks", "eyes_teeth_tongue_present")
        or report_bool(report, "validation_questions", "eyes_teeth_tongue_present")
    )
    mask_atlas = validate_reported_mask_atlas(report)

    checks = [
        Check(
            "glb_header_and_json_chunk_valid",
            not glb_errors,
            "; ".join(glb_errors) if glb_errors else f"{len(glb_meta.get('chunks', []))} chunks parsed",
        ),
        Check(
            "report_json_valid",
            not report_errors,
            "; ".join(report_errors) if report_errors else "report loaded",
        ),
        Check(
            "report_counts_match_glb",
            counts_match,
            f"glb={stats}, report={rstats}",
        ),
        Check(
            "animations_preserved",
            stats["animation_count"] >= min_animations
            and (rstats["animation_count"] is None or rstats["animation_count"] >= min_animations),
            f"animations glb={stats['animation_count']} report={rstats['animation_count']} min={min_animations}",
        ),
        Check(
            "mesh_count_within_budget",
            stats["mesh_count"] <= max_meshes
            and (rstats["mesh_count"] is None or rstats["mesh_count"] <= max_meshes),
            f"meshes glb={stats['mesh_count']} report={rstats['mesh_count']} max={max_meshes}",
        ),
        Check(
            "material_count_within_budget",
            stats["material_count"] <= max_materials
            and (rstats["material_count"] is None or rstats["material_count"] <= max_materials),
            f"materials glb={stats['material_count']} report={rstats['material_count']} max={max_materials}",
        ),
        Check(
            "no_forbidden_face_prop_names",
            not forbidden_names and report_bool(report, "validation", "checks", "no_forbidden_prop_names"),
            f"forbidden={forbidden_names}",
        ),
        Check(
            "no_reported_face_region_intruders",
            not face_intruders and report_bool(report, "validation", "checks", "no_detached_face_region_intruders"),
            f"intruders={face_intruders}",
        ),
        Check(
            "head_vertex_color_mask_present",
            head_mask_report_present and head_has_vertex_color(gltf),
            f"report={head_mask_report_present} glb_COLOR_attr={head_has_vertex_color(gltf)}",
        ),
        Check(
            "eyes_teeth_tongue_present",
            eyes_teeth_tongue_report_present and all(part_presence.values()),
            f"report={eyes_teeth_tongue_report_present} parts={part_presence}",
        ),
        Check(
            "no_external_textures_when_report_false",
            not report_says_no_external or not ext_refs,
            f"report_external_textures={rstats.get('external_textures')} refs={ext_refs}",
        ),
        Check(
            "mask_atlas_declared",
            bool(mask_atlas.get("declared")),
            str(mask_atlas.get("errors") or "declared"),
        ),
        Check(
            "mask_atlas_file_rgba_expected_size",
            bool(mask_atlas.get("declared")) and not any(
                "missing" in error
                or "unavailable" in error
                or "read failed" in error
                or "mode" in error
                or "dimensions" in error
                or "channel convention" in error
                for error in mask_atlas.get("errors", [])
            ),
            f"path={mask_atlas.get('path')} mode={mask_atlas.get('mode')} dimensions={mask_atlas.get('dimensions')} errors={mask_atlas.get('errors')}",
        ),
        Check(
            "mask_atlas_channels_nonblank",
            bool(mask_atlas.get("declared"))
            and not mask_atlas.get("blank_channels")
            and not mask_atlas.get("reported_blank_channels")
            and report_bool(report, "validation", "checks", "mask_atlas_channels_nonblank"),
            f"extrema={mask_atlas.get('channel_extrema')} report_blank={mask_atlas.get('reported_blank_channels')}",
        ),
    ]

    summary = {
        "glb": glb_meta,
        "stats": stats,
        "report_stats": rstats,
        "forbidden_names": forbidden_names,
        "face_region_intruders": face_intruders,
        "expected_parts": part_presence,
        "external_texture_refs": ext_refs,
        "mask_atlas": mask_atlas,
    }
    return checks, summary


def print_text_summary(checks: list[Check], summary: dict[str, Any]) -> None:
    passed = all(check.passed for check in checks)
    print(("PASS" if passed else "FAIL") + " validate-experiment-asset")
    print(
        "stats: "
        f"meshes={summary['stats']['mesh_count']} "
        f"materials={summary['stats']['material_count']} "
        f"animations={summary['stats']['animation_count']} "
        f"bytes={summary['glb'].get('byte_length')}"
    )
    for check in checks:
        marker = "PASS" if check.passed else "FAIL"
        print(f"{marker} {check.name}: {check.detail}")


def main() -> int:
    args = parse_args()
    gltf, glb_meta, glb_errors = load_glb_json(args.glb)
    report, report_errors = load_report(args.report)
    checks, summary = build_checks(
        gltf,
        glb_meta,
        glb_errors,
        report,
        report_errors,
        args.min_animations,
        args.max_meshes,
        args.max_materials,
    )
    passed = all(check.passed for check in checks)

    payload = {
        "passed": passed,
        "checks": [
            {"name": check.name, "passed": check.passed, "detail": check.detail}
            for check in checks
        ],
        **summary,
    }
    if args.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print_text_summary(checks, summary)
    return 0 if passed else 1


if __name__ == "__main__":
    sys.exit(main())
