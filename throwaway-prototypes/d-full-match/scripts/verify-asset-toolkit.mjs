#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const requiredCommands = [
  {
    name: "blender",
    command: "blender",
    args: ["--version"],
    summary: "Blender CLI for headless character import/export, geometry edits, renders, and audits.",
  },
  {
    name: "python3",
    command: "python3",
    args: ["--version"],
    summary: "Python runtime for asset automation checks and image/geometry helpers.",
  },
];

const optionalCommands = [
  {
    name: "gltf-transform",
    command: "gltf-transform",
    args: ["--version"],
    summary: "Fast GLB inspection/optimization without launching Blender.",
  },
];

const pythonModules = [
  {
    label: "numpy",
    importName: "numpy",
    required: true,
    summary: "Required baseline for geometry/image math in existing Blender-side asset scripts.",
  },
  {
    label: "PIL",
    importName: "PIL",
    required: true,
    summary: "Required baseline for lightweight image and texture IO.",
  },
  {
    label: "cv2",
    importName: "cv2",
    required: false,
    summary: "Optional mask processing and image comparison.",
  },
  {
    label: "trimesh",
    importName: "trimesh",
    required: false,
    summary: "Optional fast mesh inspection and bounding-box/topology audits.",
  },
  {
    label: "pygltflib",
    importName: "pygltflib",
    required: false,
    summary: "Optional GLB/glTF metadata inspection and patching.",
  },
  {
    label: "imageio",
    importName: "imageio",
    required: false,
    summary: "Optional texture/image IO beyond Pillow.",
  },
  {
    label: "skimage",
    importName: "skimage",
    required: false,
    summary: "Optional mask morphology and image-derived validation.",
  },
  {
    label: "networkx",
    importName: "networkx",
    required: false,
    summary: "Optional graph-based mesh/topology analysis.",
  },
];

function run(command, args) {
  return spawnSync(command, args, {
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  });
}

function firstLine(value) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "";
}

function checkCommand({ name, command, args, summary }) {
  const result = run(command, args);
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
  return {
    name,
    ok: result.status === 0,
    version: firstLine(output),
    error: result.error ? result.error.message : firstLine(output),
    summary,
  };
}

function checkImageMagick() {
  const identify = checkCommand({
    name: "identify",
    command: "identify",
    args: ["-version"],
    summary: "ImageMagick identify CLI.",
  });
  const magick = checkCommand({
    name: "magick",
    command: "magick",
    args: ["-version"],
    summary: "ImageMagick magick CLI.",
  });

  return {
    name: "imagemagick",
    ok: identify.ok || magick.ok,
    version: identify.ok
      ? `identify: ${identify.version}`
      : magick.ok
        ? `magick: ${magick.version}`
        : "",
    detail: `identify=${identify.ok ? "present" : "missing"}, magick=${magick.ok ? "present" : "missing"}`,
    error: [identify.error, magick.error].filter(Boolean).join("; "),
    summary: "ImageMagick CLI for texture dimension checks, resizing, and mask diagnostics.",
  };
}

function checkPythonModules() {
  const moduleSpec = pythonModules.map(({ label, importName }) => ({ label, importName }));
  const code = `
import importlib
import json

modules = ${JSON.stringify(moduleSpec)}
results = []
for module in modules:
    try:
        imported = importlib.import_module(module["importName"])
        version = getattr(imported, "__version__", "")
        results.append({
            "label": module["label"],
            "importName": module["importName"],
            "ok": True,
            "version": str(version),
        })
    except Exception as exc:
        results.append({
            "label": module["label"],
            "importName": module["importName"],
            "ok": False,
            "error": f"{type(exc).__name__}: {exc}",
        })
print(json.dumps(results))
`;

  const result = run("python3", ["-c", code]);
  if (result.status !== 0) {
    const output = [result.stdout, result.stderr].filter(Boolean).join("\n");
    return pythonModules.map((module) => ({
      ...module,
      ok: false,
      error: result.error ? result.error.message : firstLine(output),
    }));
  }

  const byLabel = new Map(JSON.parse(result.stdout).map((entry) => [entry.label, entry]));
  return pythonModules.map((module) => ({
    ...module,
    ...byLabel.get(module.label),
  }));
}

function printRows(title, rows, { required }) {
  console.log(`\n${title}`);
  for (const row of rows) {
    const status = row.ok ? "PASS" : required ? "FAIL" : "WARN";
    const version = row.version ? ` - ${row.version}` : "";
    const detail = row.detail ? ` (${row.detail})` : "";
    console.log(`  ${status} ${row.name ?? row.label}${version}${detail}`);
    if (!row.ok && row.error) {
      console.log(`       ${row.error}`);
    }
  }
}

const commandResults = [...requiredCommands.map(checkCommand), checkImageMagick()];
const optionalCommandResults = optionalCommands.map(checkCommand);
const moduleResults = checkPythonModules();
const requiredModuleResults = moduleResults.filter((module) => module.required);
const optionalModuleResults = moduleResults.filter((module) => !module.required);

printRows("Required command tools", commandResults, { required: true });
printRows("Required Python modules", requiredModuleResults, { required: true });
printRows("Optional command tools", optionalCommandResults, { required: false });
printRows("Optional Python modules", optionalModuleResults, { required: false });

const requiredFailures = [...commandResults, ...requiredModuleResults].filter((row) => !row.ok);
const optionalMissing = [...optionalCommandResults, ...optionalModuleResults].filter((row) => !row.ok);

if (optionalMissing.length > 0) {
  console.log(`\nOptional gaps: ${optionalMissing.map((row) => row.name ?? row.label).join(", ")}`);
}

if (requiredFailures.length > 0) {
  console.error(`\nAsset toolkit verification FAIL: missing required ${requiredFailures.map((row) => row.name ?? row.label).join(", ")}`);
  process.exit(1);
}

console.log("\nAsset toolkit verification PASS");
