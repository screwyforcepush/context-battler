#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(appDir, "../..");
const source = path.join(repoRoot, "throwaway-prototypes", "shared-harness");
const target = path.join(appDir, "shared-harness");

if (!existsSync(source)) {
  throw new Error(`Missing shared harness at ${source}`);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(appDir, { recursive: true });
cpSync(source, target, { recursive: true });
console.log(`Synced shared harness into ${path.relative(repoRoot, target)}`);
