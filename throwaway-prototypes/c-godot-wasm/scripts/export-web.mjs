#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(appDir, "../..");
const distDir = path.join(appDir, "dist");
const outHtml = path.join(distDir, "index.html");
const sharedHarness = path.join(repoRoot, "throwaway-prototypes", "shared-harness");

const candidates = [
  process.env.GODOT_BIN,
  "/tmp/context-battler-godot/Godot_v4.6.2-stable_linux.arm64",
  "/tmp/context-battler-godot/Godot_v4.6.2-stable_linux.x86_64",
  "godot4",
  "godot",
].filter(Boolean);

function commandExists(command) {
  if (command.includes("/") && existsSync(command)) return command;
  const result = spawnSync("bash", ["-lc", `command -v ${JSON.stringify(command)}`], {
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

const godot = candidates.map(commandExists).find(Boolean);
if (!godot) {
  throw new Error(
    `Godot 4 binary not found. Set GODOT_BIN=/path/to/Godot_v4.6.2-stable_linux.${os.arch() === "arm64" ? "arm64" : "x86_64"}`,
  );
}

rmSync(distDir, { recursive: true, force: true });
mkdirSync(distDir, { recursive: true });

const result = spawnSync(
  godot,
  ["--headless", "--path", appDir, "--export-release", "Web", outHtml],
  { cwd: appDir, stdio: "inherit" },
);

if (result.status !== 0) {
  throw new Error(`Godot export failed with exit code ${result.status}`);
}

cpSync(sharedHarness, path.join(distDir, "shared-harness"), {
  recursive: true,
});
cpSync(path.join(appDir, "godot-telefrag-hooks.js"), path.join(distDir, "godot-telefrag-hooks.js"));
console.log(`Exported Godot web build to ${path.relative(appDir, distDir)}`);
