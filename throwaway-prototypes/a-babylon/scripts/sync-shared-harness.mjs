import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const prototypeRoot = resolve(here, "..");
const source = resolve(prototypeRoot, "../shared-harness");
const target = resolve(prototypeRoot, "public/shared-harness");

rmSync(target, { recursive: true, force: true });

if (!existsSync(source)) {
  mkdirSync(target, { recursive: true });
  console.warn(
    `[sync:harness] ${source} is not present; created an empty ${target}. The app will show its runtime fixture warning.`,
  );
  process.exit(0);
}

mkdirSync(resolve(target, ".."), { recursive: true });
cpSync(source, target, {
  recursive: true,
  force: true,
  errorOnExist: false,
  preserveTimestamps: true,
});

console.log(`[sync:harness] copied ${source} -> ${target}`);
