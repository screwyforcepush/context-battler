#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(appDir, "../..");
const distDir = path.join(appDir, "dist");
const outHtml = path.join(distDir, "index.html");
const sharedHarness = path.join(repoRoot, "throwaway-prototypes", "shared-harness");
const customLoaderMarker = "<!-- telefrag-custom-loader -->";

const customLoaderStyle = `${customLoaderMarker}
		<style>
#status {
	background:
		linear-gradient(rgba(0, 0, 0, 0.56), rgba(0, 0, 0, 0.78)),
		repeating-linear-gradient(0deg, rgba(0, 230, 255, 0.08) 0 1px, transparent 1px 34px),
		repeating-linear-gradient(90deg, rgba(255, 40, 70, 0.06) 0 1px, transparent 1px 42px),
		#03070b;
	color: #f4fbff;
	display: grid;
	font-family: "Inter", "Segoe UI", Arial, sans-serif;
	inset: 0;
	overflow: hidden;
	place-items: center;
	visibility: hidden;
	z-index: 10;
}

#status::before,
#status::after {
	content: "";
	inset: 0;
	pointer-events: none;
	position: absolute;
}

#status::before {
	background: repeating-linear-gradient(180deg, rgba(255, 255, 255, 0.045) 0 1px, transparent 1px 4px);
	mix-blend-mode: screen;
	opacity: 0.22;
}

#status::after {
	animation: telefrag-scan 2.7s linear infinite;
	background: linear-gradient(180deg, transparent 0%, rgba(0, 230, 255, 0.26) 48%, transparent 58%);
	transform: translateY(-100%);
}

.telefrag-loader {
	box-sizing: border-box;
	max-width: 620px;
	padding: 24px;
	position: relative;
	width: calc(100% - 32px);
	z-index: 1;
}

.telefrag-register {
	background: rgba(2, 7, 12, 0.86);
	border: 1px solid rgba(0, 230, 255, 0.48);
	border-radius: 6px;
	box-shadow: 0 0 0 1px rgba(255, 40, 70, 0.16), 0 24px 80px rgba(0, 0, 0, 0.62);
	padding: 22px;
	position: relative;
}

.telefrag-register::before {
	border: 1px solid rgba(255, 40, 70, 0.38);
	content: "";
	inset: 8px;
	pointer-events: none;
	position: absolute;
}

.telefrag-kicker,
.telefrag-row span,
.telefrag-row i {
	color: #89f7ff;
	font-size: 0.72rem;
	font-style: normal;
	font-weight: 700;
	letter-spacing: 0;
	text-transform: uppercase;
}

.telefrag-title {
	color: #ffffff;
	font-size: 1.85rem;
	font-weight: 800;
	letter-spacing: 0;
	line-height: 1.05;
	margin-top: 10px;
	text-transform: uppercase;
}

.telefrag-subtitle {
	color: #ffda78;
	font-size: 0.9rem;
	line-height: 1.45;
	margin-top: 8px;
}

.telefrag-grid {
	border-top: 1px solid rgba(137, 247, 255, 0.26);
	display: grid;
	gap: 8px;
	margin-top: 20px;
	padding-top: 16px;
}

.telefrag-row {
	align-items: center;
	display: grid;
	gap: 10px;
	grid-template-columns: 74px minmax(0, 1fr) 72px;
	min-height: 28px;
}

.telefrag-row b {
	color: #f5fbff;
	font-size: 0.86rem;
	font-weight: 700;
	letter-spacing: 0;
	overflow-wrap: anywhere;
	text-transform: uppercase;
}

.telefrag-row i {
	color: #ff4f68;
	text-align: right;
}

#status-progress {
	appearance: none;
	background: rgba(137, 247, 255, 0.1);
	border: 1px solid rgba(137, 247, 255, 0.42);
	border-radius: 0;
	bottom: auto;
	box-sizing: border-box;
	display: none;
	height: 12px;
	margin: 20px 0 0;
	position: static;
	width: 100%;
}

#status-progress::-webkit-progress-bar {
	background: rgba(137, 247, 255, 0.1);
}

#status-progress::-webkit-progress-value {
	background: linear-gradient(90deg, #00e6ff, #ff2d4d);
}

#status-progress::-moz-progress-bar {
	background: linear-gradient(90deg, #00e6ff, #ff2d4d);
}

#status-notice {
	background: rgba(45, 8, 16, 0.9);
	border: 1px solid rgba(255, 79, 104, 0.72);
	border-radius: 6px;
	color: #f8eef1;
	display: none;
	font-family: "Inter", "Segoe UI", Arial, sans-serif;
	font-size: 0.92rem;
	line-height: 1.4;
	margin: 16px 0 0;
	overflow-wrap: anywhere;
	padding: 12px;
	position: static;
	text-align: left;
}

#status-splash,
#-gd-engine-icon {
	display: none !important;
}

@keyframes telefrag-scan {
	from {
		transform: translateY(-100%);
	}

	to {
		transform: translateY(100%);
	}
}

@media (max-width: 520px) {
	.telefrag-loader {
		padding: 12px;
		width: calc(100% - 18px);
	}

	.telefrag-register {
		padding: 18px;
	}

	.telefrag-title {
		font-size: 1.45rem;
	}

	.telefrag-row {
		grid-template-columns: 58px minmax(0, 1fr) 58px;
	}
}
		</style>`;

const customStatusMarkup = `		<div id="status" aria-live="polite">
			<div class="telefrag-loader" role="status" aria-label="Loading Context Battler replay">
				<div class="telefrag-register">
					<div class="telefrag-kicker">Context Battler // Web Replay</div>
					<div class="telefrag-title">Telefrag Register</div>
					<div class="telefrag-subtitle">duel fixture &gt; drop-zone vector &gt; red mist camera</div>
					<div class="telefrag-grid" aria-hidden="true">
						<div class="telefrag-row"><span>boot</span><b>WASM payload</b><i>pending</i></div>
						<div class="telefrag-row"><span>bridge</span><b>Replay snapshot</b><i>armed</i></div>
						<div class="telefrag-row"><span>camera</span><b>Kill-cam orbit</b><i>queued</i></div>
						<div class="telefrag-row"><span>impact</span><b>Red mist pass</b><i>locked</i></div>
					</div>
					<progress id="status-progress" aria-label="Replay boot progress"></progress>
					<div id="status-notice"></div>
				</div>
			</div>
		</div>`;

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

function replaceTitle(html) {
  return html.replace(/<title>[^<]*<\/title>/, "<title>Context Battler Telefrag Register</title>");
}

function removeExportedIcons(html) {
  const withoutGeneratedIcons = html
    .replace(/\n?\s*<link id="-gd-engine-icon"[^>]*>\s*/g, "\n")
    .replace(/\n?\s*<link rel="apple-touch-icon"[^>]*\/?>\s*/g, "\n");
  if (withoutGeneratedIcons.includes('rel="icon"')) {
    return withoutGeneratedIcons;
  }
  return withoutGeneratedIcons.replace(
    "</head>",
    '\t\t<link rel="icon" href="data:,">\n\t</head>',
  );
}

function replaceMissingFeaturesCopy(html) {
  return html.replace(
    "Error\\nThe following features required to run Godot projects on the Web are missing:\\n",
    "Error\\nThis prototype requires browser features that are unavailable:\\n",
  );
}

function injectLoaderStyle(html) {
  if (html.includes(customLoaderMarker)) {
    return html;
  }
  const styleClose = "</style>";
  const styleIndex = html.indexOf(styleClose);
  if (styleIndex === -1) {
    throw new Error("Unable to patch Godot HTML shell: missing closing style tag.");
  }
  const insertAt = styleIndex + styleClose.length;
  return `${html.slice(0, insertAt)}\n${customLoaderStyle}${html.slice(insertAt)}`;
}

function removeHookScript(html) {
  return html.replace(/\n?\s*<script src="godot-telefrag-hooks\.js"><\/script>\s*/g, "\n");
}

function replaceStatusShell(html) {
  const indexScriptMatch = html.match(/\s*<script src="index\.js"><\/script>/);
  if (!indexScriptMatch || indexScriptMatch.index === undefined) {
    throw new Error("Unable to patch Godot HTML shell: missing index.js script tag.");
  }
  const indexScript = indexScriptMatch[0];
  const scriptIndex = indexScriptMatch.index;

  const statusStart = html.indexOf("\n\t\t<div id=\"status\"");
  const runtimeScripts = `\n${customStatusMarkup}\n\n\t\t<script src="godot-telefrag-hooks.js"></script>\n\t\t<script src="index.js"></script>`;
  if (statusStart !== -1 && statusStart < scriptIndex) {
    return `${html.slice(0, statusStart)}${runtimeScripts}${html.slice(scriptIndex + indexScript.length)}`;
  }

  return `${html.slice(0, scriptIndex)}\n\t\t<script src="godot-telefrag-hooks.js"></script>${html.slice(scriptIndex)}`;
}

function stripTrailingWhitespace(html) {
  return html.replace(/[ \t]+$/gm, "");
}

export function patchGodotHtmlShell(html) {
  let patched = replaceTitle(html);
  patched = removeExportedIcons(patched);
  patched = replaceMissingFeaturesCopy(patched);
  patched = injectLoaderStyle(patched);
  patched = removeHookScript(patched);
  patched = replaceStatusShell(patched);
  return stripTrailingWhitespace(patched);
}

function removeGeneratedBrandingAssets() {
  for (const fileName of ["index.png", "index.icon.png", "index.apple-touch-icon.png"]) {
    rmSync(path.join(distDir, fileName), { force: true });
  }
}

export function exportWeb() {
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

  const generatedHtml = readFileSync(outHtml, "utf8");
  writeFileSync(outHtml, patchGodotHtmlShell(generatedHtml), "utf8");
  removeGeneratedBrandingAssets();

  cpSync(sharedHarness, path.join(distDir, "shared-harness"), {
    recursive: true,
  });
  cpSync(path.join(appDir, "godot-telefrag-hooks.js"), path.join(distDir, "godot-telefrag-hooks.js"));
  console.log(`Exported Godot web build to ${path.relative(appDir, distDir)} with custom loading screen`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  exportWeb();
}
