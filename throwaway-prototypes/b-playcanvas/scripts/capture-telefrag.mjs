#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { gzipSync } from "node:zlib";
import { randomBytes } from "node:crypto";

const PROFILE = {
  width: 390,
  height: 844,
  deviceScaleFactor: 2,
  latencyMs: 150,
  downloadKiBps: 200,
  uploadKiBps: 75,
  cpuSlowdown: 4,
};

const DEFAULT_READY_EXPRESSION = [
  "window.__telefragReady === true",
  "window.__prototypeReady === true",
  'typeof window.__telefragReadyAt === "number"',
  'document.documentElement.dataset.ready === "true"',
  'document.body && document.body.dataset.ready === "true"',
  'document.querySelector("#cameraToggle")?.textContent?.includes("Follow")',
].join(" || ");

function usage() {
  console.log(`Usage:
  node scripts/capture-telefrag.mjs [options]

Captures telefrag-capture.png and telefrag-capture.gif from the b-playcanvas
prototype once the core app exists. By default it serves built dist/ with gzip.

Options:
  --build                         Run npm run build before capture
  --build-command <cmd>           Build command when --build is set (default: npm run build)
  --app-dir <dir>                 App directory (default: current working directory)
  --dist <dir>                    Built output directory, relative to app dir unless absolute (default: dist)
  --url <url>                     Existing app URL; skips local static server
  --path <url-path>               Static app path when --url is omitted (default: /)
  --png <file>                    Still output path (default: telefrag-capture.png)
  --gif <file>                    GIF output path (default: telefrag-capture.gif)
  --start-ms <n>                  GIF starts this many ms after navigation (default: 2500)
  --duration-ms <n>               GIF duration (default: 6500)
  --still-ms <n>                  Still capture time after navigation (default: 5500)
  --fps <n>                       GIF capture FPS (default: 10)
  --gif-width <n>                 GIF resize width in physical pixels (default: 390)
  --throttle                      Apply the scorecard CDP network/CPU throttle profile
  --ready-expression <js>         Optional boolean expression to detect app readiness
  --chrome <path>                 Chrome/Chromium executable
  --no-gif                        Capture PNG only
  --keep-frames                   Keep temporary PNG frames and print their path
  --help                          Show this help
`);
}

function parseArgs(argv) {
  const opts = {
    appDir: process.cwd(),
    dist: "dist",
    build: false,
    buildCommand: "npm run build",
    url: "",
    path: "/",
    png: "telefrag-capture.png",
    gif: "telefrag-capture.gif",
    startMs: 2_500,
    durationMs: 6_500,
    stillMs: 5_500,
    fps: 10,
    gifWidth: 390,
    throttle: false,
    readyExpression: DEFAULT_READY_EXPRESSION,
    chrome: process.env.CHROME_BIN || "",
    noGif: false,
    keepFrames: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) {
        throw new Error(`Missing value for ${arg}`);
      }
      return argv[i];
    };

    if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else if (arg === "--build") {
      opts.build = true;
    } else if (arg === "--build-command") {
      opts.buildCommand = next();
    } else if (arg === "--app-dir") {
      opts.appDir = next();
    } else if (arg === "--dist") {
      opts.dist = next();
    } else if (arg === "--url") {
      opts.url = next();
    } else if (arg === "--path") {
      opts.path = next();
    } else if (arg === "--png") {
      opts.png = next();
    } else if (arg === "--gif") {
      opts.gif = next();
    } else if (arg === "--start-ms") {
      opts.startMs = Number(next());
    } else if (arg === "--duration-ms") {
      opts.durationMs = Number(next());
    } else if (arg === "--still-ms") {
      opts.stillMs = Number(next());
    } else if (arg === "--fps") {
      opts.fps = Number(next());
    } else if (arg === "--gif-width") {
      opts.gifWidth = Number(next());
    } else if (arg === "--throttle") {
      opts.throttle = true;
    } else if (arg === "--ready-expression") {
      opts.readyExpression = next();
    } else if (arg === "--chrome") {
      opts.chrome = next();
    } else if (arg === "--no-gif") {
      opts.noGif = true;
    } else if (arg === "--keep-frames") {
      opts.keepFrames = true;
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return opts;
}

function assertNonNegative(value, label) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative number`);
  }
}

function assertPositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
}

function runCommand(command, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd,
      shell: true,
      stdio: "inherit",
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${command} exited with ${code}`));
      }
    });
    child.on("error", reject);
  });
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js" || ext === ".mjs") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".glb") return "model/gltf-binary";
  if (ext === ".gltf") return "model/gltf+json";
  if (ext === ".wasm") return "application/wasm";
  return "application/octet-stream";
}

function safeStaticPath(root, requestUrl) {
  const url = new URL(requestUrl, "http://localhost");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith("/")) {
    pathname += "index.html";
  }
  const fullPath = path.resolve(root, `.${pathname}`);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  if (existsSync(fullPath) && statSync(fullPath).isDirectory()) {
    return path.join(fullPath, "index.html");
  }
  return fullPath;
}

function startGzipServer(distDir) {
  const server = createServer((req, res) => {
    const filePath = safeStaticPath(distDir, req.url ?? "/");
    if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404, {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
      });
      res.end("Not found");
      return;
    }

    const encoded = gzipSync(readFileSync(filePath), { level: 9 });
    res.writeHead(200, {
      "Cache-Control": "no-store",
      "Content-Encoding": "gzip",
      "Content-Length": String(encoded.byteLength),
      "Content-Type": contentType(filePath),
      Vary: "Accept-Encoding",
    });
    res.end(encoded);
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to resolve static server address"));
        return;
      }
      resolve({
        server,
        origin: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFreePort() {
  const server = net.createServer();
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === "string") {
          reject(new Error("Unable to reserve a port"));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

function findChrome(explicitPath) {
  const candidates = [
    explicitPath,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  const match = candidates.find((candidate) => existsSync(candidate));
  if (!match) {
    throw new Error("Chrome/Chromium was not found. Pass --chrome <path>.");
  }
  return match;
}

async function launchChrome(opts) {
  const port = await getFreePort();
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), "b-playcanvas-capture-"));
  const chromePath = findChrome(opts.chrome);
  const args = [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--hide-scrollbars",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "about:blank",
  ];
  const child = spawn(chromePath, args, {
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.on("data", () => {});
  await waitForJson(`http://127.0.0.1:${port}/json/version`, 10_000);
  return { child, port, userDataDir };
}

async function removeDirWithRetry(dir) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 4) {
        throw error;
      }
      await wait(200);
    }
  }
}

async function stopChrome(chrome) {
  if (chrome.child.exitCode === null && !chrome.child.killed) {
    const exited = new Promise((resolve) => chrome.child.once("exit", resolve));
    chrome.child.kill("SIGTERM");
    await Promise.race([exited, wait(2_000)]);
  }
  await removeDirWithRetry(chrome.userDataDir);
}

async function waitForJson(url, timeoutMs) {
  const start = performance.now();
  let lastError = null;
  while (performance.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.json();
      }
    } catch (error) {
      lastError = error;
    }
    await wait(100);
  }
  throw new Error(`Timed out waiting for ${url}${lastError ? `: ${lastError.message}` : ""}`);
}

async function pageWebSocketUrl(port) {
  const list = await waitForJson(`http://127.0.0.1:${port}/json/list`, 10_000);
  const page = list.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
  if (!page) {
    throw new Error("No debuggable page target found");
  }
  return page.webSocketDebuggerUrl;
}

class CdpSession {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    this.socket = null;
  }

  async connect() {
    const ws = new URL(this.wsUrl);
    const key = randomBytes(16).toString("base64");
    this.socket = net.createConnection({
      host: ws.hostname,
      port: Number(ws.port || 80),
    });

    await new Promise((resolve, reject) => {
      const cleanup = () => {
        this.socket.off("data", onData);
        this.socket.off("error", onError);
      };
      const onError = (error) => {
        cleanup();
        reject(error);
      };
      const onData = (chunk) => {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        const splitAt = this.buffer.indexOf("\r\n\r\n");
        if (splitAt === -1) {
          return;
        }
        const head = this.buffer.subarray(0, splitAt).toString("utf8");
        const rest = this.buffer.subarray(splitAt + 4);
        cleanup();
        if (!head.includes(" 101 ")) {
          reject(new Error(`WebSocket upgrade failed: ${head.split("\r\n")[0]}`));
          return;
        }
        this.buffer = Buffer.alloc(0);
        this.socket.on("data", (data) => this.handleData(data));
        this.socket.on("error", (error) => this.rejectAll(error));
        this.socket.on("close", () => this.rejectAll(new Error("CDP socket closed")));
        if (rest.byteLength > 0) {
          this.handleData(rest);
        }
        resolve();
      };
      this.socket.on("error", onError);
      this.socket.on("data", onData);
      this.socket.on("connect", () => {
        const requestPath = `${ws.pathname}${ws.search}`;
        this.socket.write(
          [
            `GET ${requestPath} HTTP/1.1`,
            `Host: ${ws.host}`,
            "Upgrade: websocket",
            "Connection: Upgrade",
            `Sec-WebSocket-Key: ${key}`,
            "Sec-WebSocket-Version: 13",
            "\r\n",
          ].join("\r\n"),
        );
      });
    });
  }

  async send(method, params = {}) {
    if (!this.socket) {
      throw new Error("CDP session is not connected");
    }
    const id = this.nextId;
    this.nextId += 1;
    this.sendFrame(0x1, Buffer.from(JSON.stringify({ id, method, params }), "utf8"));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, 30_000);
      this.pending.set(id, { resolve, reject, timeout, method });
    });
  }

  close() {
    if (this.socket) {
      this.socket.end();
    }
  }

  rejectAll(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  handleData(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.byteLength >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const opcode = first & 0x0f;
      const masked = (second & 0x80) !== 0;
      let length = second & 0x7f;
      let offset = 2;

      if (length === 126) {
        if (this.buffer.byteLength < offset + 2) return;
        length = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (this.buffer.byteLength < offset + 8) return;
        const bigLength = this.buffer.readBigUInt64BE(offset);
        if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new Error("WebSocket frame too large");
        }
        length = Number(bigLength);
        offset += 8;
      }

      const maskOffset = offset;
      if (masked) {
        offset += 4;
      }
      if (this.buffer.byteLength < offset + length) return;

      let payload = this.buffer.subarray(offset, offset + length);
      if (masked) {
        const mask = this.buffer.subarray(maskOffset, maskOffset + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.byteLength; i += 1) {
          payload[i] ^= mask[i % 4];
        }
      }
      this.buffer = this.buffer.subarray(offset + length);

      if (opcode === 0x1) {
        this.handleMessage(payload.toString("utf8"));
      } else if (opcode === 0x8) {
        this.close();
      } else if (opcode === 0x9) {
        this.sendFrame(0xA, payload);
      }
    }
  }

  handleMessage(text) {
    const message = JSON.parse(text);
    if (!message.id) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(message.id);
    if (message.error) {
      pending.reject(
        new Error(`${pending.method}: ${message.error.message ?? JSON.stringify(message.error)}`),
      );
    } else {
      pending.resolve(message.result ?? {});
    }
  }

  sendFrame(opcode, payload) {
    const length = payload.byteLength;
    let headerLength = 2;
    if (length >= 126 && length <= 65_535) {
      headerLength += 2;
    } else if (length > 65_535) {
      headerLength += 8;
    }
    const header = Buffer.alloc(headerLength);
    header[0] = 0x80 | opcode;
    let offset = 2;
    if (length < 126) {
      header[1] = 0x80 | length;
    } else if (length <= 65_535) {
      header[1] = 0x80 | 126;
      header.writeUInt16BE(length, offset);
      offset += 2;
    } else {
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(length), offset);
      offset += 8;
    }
    const mask = randomBytes(4);
    const maskedPayload = Buffer.from(payload);
    for (let i = 0; i < maskedPayload.byteLength; i += 1) {
      maskedPayload[i] ^= mask[i % 4];
    }
    this.socket.write(Buffer.concat([header, mask, maskedPayload]));
  }
}

async function applyProfile(cdp, throttle) {
  await cdp.send("Network.enable");
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: PROFILE.width,
    height: PROFILE.height,
    deviceScaleFactor: PROFILE.deviceScaleFactor,
    mobile: true,
    screenWidth: PROFILE.width,
    screenHeight: PROFILE.height,
  });
  if (throttle) {
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: PROFILE.latencyMs,
      downloadThroughput: PROFILE.downloadKiBps * 1024,
      uploadThroughput: PROFILE.uploadKiBps * 1024,
      connectionType: "cellular3g",
    });
    await cdp.send("Emulation.setCPUThrottlingRate", {
      rate: PROFILE.cpuSlowdown,
    });
  }
}

async function checkReady(cdp, readyExpression) {
  const expression = `(() => {
    try {
      return Boolean(${readyExpression});
    } catch (error) {
      return false;
    }
  })()`;
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  return Boolean(result.result?.value);
}

function resolveOut(appDir, filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(appDir, filePath);
}

function commandExists(command) {
  const check = spawnSync("sh", ["-lc", `command -v ${JSON.stringify(command)} >/dev/null 2>&1`]);
  return check.status === 0;
}

function findGifTool() {
  if (commandExists("ffmpeg")) return { kind: "ffmpeg", command: "ffmpeg" };
  if (commandExists("magick")) return { kind: "magick", command: "magick" };
  if (commandExists("convert")) return { kind: "convert", command: "convert" };
  return null;
}

function assembleGif({ frames, gifPath, fps, gifWidth }) {
  const tool = findGifTool();
  if (!tool) {
    throw new Error("No ffmpeg, magick, or convert executable found for GIF assembly.");
  }

  if (tool.kind === "ffmpeg") {
    const framePattern = path.join(path.dirname(frames[0]), "frame-%04d.png");
    const result = spawnSync(
      tool.command,
      [
        "-y",
        "-framerate",
        String(fps),
        "-i",
        framePattern,
        "-vf",
        `scale=${gifWidth}:-1:flags=lanczos`,
        gifPath,
      ],
      { stdio: "inherit" },
    );
    if (result.status !== 0) {
      throw new Error(`ffmpeg exited with ${result.status}`);
    }
    return tool.kind;
  }

  const delay = Math.max(1, Math.round(100 / fps));
  const args = [
    "-delay",
    String(delay),
    "-loop",
    "0",
    ...frames,
    "-resize",
    `${gifWidth}x`,
    gifPath,
  ];
  const result = spawnSync(tool.command, args, { stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${tool.command} exited with ${result.status}`);
  }
  return tool.kind;
}

async function waitUntilSince(start, targetMs) {
  const remaining = targetMs - (performance.now() - start);
  if (remaining > 0) {
    await wait(remaining);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    usage();
    return;
  }
  assertNonNegative(opts.startMs, "--start-ms");
  assertNonNegative(opts.durationMs, "--duration-ms");
  assertNonNegative(opts.stillMs, "--still-ms");
  assertPositive(opts.fps, "--fps");
  assertPositive(opts.gifWidth, "--gif-width");

  const appDir = path.resolve(opts.appDir);
  const distDir = path.isAbsolute(opts.dist) ? opts.dist : path.join(appDir, opts.dist);
  const pngPath = resolveOut(appDir, opts.png);
  const gifPath = resolveOut(appDir, opts.gif);

  if (opts.build) {
    await runCommand(opts.buildCommand, appDir);
  }

  let server = null;
  let targetUrl = opts.url;
  if (!targetUrl) {
    if (!existsSync(path.join(distDir, "index.html"))) {
      throw new Error(`Expected built Vite app at ${path.join(distDir, "index.html")}`);
    }
    const staticServer = await startGzipServer(distDir);
    server = staticServer.server;
    targetUrl = new URL(opts.path, `${staticServer.origin}/`).toString();
  }

  const frameDir = mkdtempSync(path.join(os.tmpdir(), "b-playcanvas-frames-"));
  let chrome = null;
  let cdp = null;
  const frames = [];

  try {
    chrome = await launchChrome(opts);
    cdp = new CdpSession(await pageWebSocketUrl(chrome.port));
    await cdp.connect();
    await applyProfile(cdp, opts.throttle);

    const navStart = performance.now();
    await cdp.send("Page.navigate", { url: targetUrl });

    let readyMs = null;
    const readyPollEnd = Math.min(opts.startMs, 5_000);
    while (performance.now() - navStart < readyPollEnd) {
      if (await checkReady(cdp, opts.readyExpression)) {
        readyMs = Math.round(performance.now() - navStart);
        break;
      }
      await wait(200);
    }

    let stillCaptured = false;
    if (opts.stillMs <= opts.startMs) {
      await waitUntilSince(navStart, opts.stillMs);
      const still = await cdp.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: false,
      });
      writeFileSync(pngPath, Buffer.from(still.data, "base64"));
      stillCaptured = true;
    }

    await waitUntilSince(navStart, opts.startMs);
    const frameCount = opts.noGif ? 0 : Math.max(1, Math.ceil((opts.durationMs / 1000) * opts.fps));
    const frameIntervalMs = 1000 / opts.fps;

    for (let i = 0; i < frameCount; i += 1) {
      await waitUntilSince(navStart, opts.startMs + i * frameIntervalMs);
      const shot = await cdp.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: false,
      });
      const framePath = path.join(frameDir, `frame-${String(i + 1).padStart(4, "0")}.png`);
      const frameBytes = Buffer.from(shot.data, "base64");
      writeFileSync(framePath, frameBytes);
      frames.push(framePath);

      if (!stillCaptured && performance.now() - navStart >= opts.stillMs) {
        writeFileSync(pngPath, frameBytes);
        stillCaptured = true;
      }
    }

    if (!stillCaptured) {
      await waitUntilSince(navStart, opts.stillMs);
      const still = await cdp.send("Page.captureScreenshot", {
        format: "png",
        fromSurface: true,
        captureBeyondViewport: false,
      });
      writeFileSync(pngPath, Buffer.from(still.data, "base64"));
      stillCaptured = true;
    }

    let gifTool = null;
    if (!opts.noGif) {
      gifTool = assembleGif({
        frames,
        gifPath,
        fps: opts.fps,
        gifWidth: opts.gifWidth,
      });
    }

    console.log(
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          url: targetUrl,
          viewportCssPixels: `${PROFILE.width}x${PROFILE.height}`,
          deviceScaleFactor: PROFILE.deviceScaleFactor,
          throttleApplied: opts.throttle,
          readyMs,
          png: pngPath,
          gif: opts.noGif ? null : gifPath,
          gifFrames: frames.length,
          gifTool,
          framesDir: opts.keepFrames ? frameDir : null,
        },
        null,
        2,
      ),
    );
  } finally {
    if (cdp) {
      cdp.close();
    }
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (chrome) {
      await stopChrome(chrome);
    }
    if (!opts.keepFrames) {
      rmSync(frameDir, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exit(1);
});
