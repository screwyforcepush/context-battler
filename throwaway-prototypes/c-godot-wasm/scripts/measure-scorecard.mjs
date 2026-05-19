#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { inflateSync, gzipSync } from "node:zlib";
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
  'typeof window.__telefragReadyAt === "number" && window.__telefragReadyAt > 0',
  'document.documentElement.dataset.ready === "true"',
  'document.body && document.body.dataset.ready === "true"',
  'document.querySelector("#cameraToggle")?.textContent?.includes("Follow")',
].join(" || ");

function usage() {
  console.log(`Usage:
  node scripts/measure-scorecard.mjs [options]

Measures the built Godot WASM export from a gzip static server with Chrome
DevTools Protocol throttling. Run from throwaway-prototypes/c-godot-wasm once
the export exists.

Options:
  --build                         Run npm run build before measuring
  --build-command <cmd>           Build command when --build is set (default: npm run build)
  --app-dir <dir>                 App directory (default: current working directory)
  --dist <dir>                    Built output directory, relative to app dir unless absolute (default: dist)
  --path <url-path>               Static app path to navigate to (default: /)
  --out <file>                    Optional JSON result path
  --chrome <path>                 Chrome/Chromium executable
  --ready-expression <js>         Boolean expression for an app-level ready frame
  --canvas-selector <selector>    Element to clip first-nonblank screenshots to (default: canvas)
  --timeout-ms <n>                Overall measurement timeout (default: 30000)
  --poll-ms <n>                   Screenshot polling interval (default: 250)
  --network-idle-ms <n>           Network quiet time before ending (default: 1000)
  --ready-grace-ms <n>            Extra ready polling after first nonblank (default: 3000)
  --help                          Show this help
`);
}

function parseArgs(argv) {
  const opts = {
    appDir: process.cwd(),
    dist: "dist",
    build: false,
    buildCommand: "npm run build",
    path: "/",
    out: "",
    chrome: process.env.CHROME_BIN || "",
    readyExpression: DEFAULT_READY_EXPRESSION,
    canvasSelector: "canvas",
    timeoutMs: 30_000,
    pollMs: 250,
    networkIdleMs: 1_000,
    readyGraceMs: 3_000,
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
    } else if (arg === "--path") {
      opts.path = next();
    } else if (arg === "--out") {
      opts.out = next();
    } else if (arg === "--chrome") {
      opts.chrome = next();
    } else if (arg === "--ready-expression") {
      opts.readyExpression = next();
    } else if (arg === "--canvas-selector") {
      opts.canvasSelector = next();
    } else if (arg === "--timeout-ms") {
      opts.timeoutMs = Number(next());
    } else if (arg === "--poll-ms") {
      opts.pollMs = Number(next());
    } else if (arg === "--network-idle-ms") {
      opts.networkIdleMs = Number(next());
    } else if (arg === "--ready-grace-ms") {
      opts.readyGraceMs = Number(next());
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  return opts;
}

function assertFinitePositive(value, label) {
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

function walkFiles(root, dir = root, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(root, fullPath, files);
    } else if (entry.isFile()) {
      files.push({
        absolute: fullPath,
        relative: path.relative(root, fullPath).split(path.sep).join("/"),
      });
    }
  }
  return files;
}

function analyzeDist(distDir) {
  const files = walkFiles(distDir)
    .map((file) => {
      const bytes = readFileSync(file.absolute);
      const gzipBytes = gzipSync(bytes, { level: 9 });
      return {
        path: file.relative,
        rawBytes: bytes.byteLength,
        gzipBytes: gzipBytes.byteLength,
      };
    })
    .sort((a, b) => a.path.localeCompare(b.path));

  const rawBytes = files.reduce((sum, file) => sum + file.rawBytes, 0);
  const gzipBytes = files.reduce((sum, file) => sum + file.gzipBytes, 0);
  const largestGzipFiles = [...files]
    .sort((a, b) => b.gzipBytes - a.gzipBytes)
    .slice(0, 8);
  const mainJs = [...files]
    .filter((file) => file.path.endsWith(".js"))
    .sort((a, b) => b.gzipBytes - a.gzipBytes)[0] ?? null;

  return {
    fileCount: files.length,
    rawBytes,
    gzipBytes,
    mainJs,
    largestGzipFiles,
  };
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
  if (ext === ".pck") return "application/octet-stream";
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
    const sharedHeaders = {
      "Cache-Control": "no-store",
      "Cross-Origin-Embedder-Policy": "require-corp",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "cross-origin",
    };
    if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404, {
        ...sharedHeaders,
        "Content-Type": "text/plain; charset=utf-8",
      });
      res.end("Not found");
      return;
    }

    const raw = readFileSync(filePath);
    const encoded = gzipSync(raw, { level: 9 });
    res.writeHead(200, {
      ...sharedHeaders,
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
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), "c-godot-wasm-measure-"));
  const chromePath = findChrome(opts.chrome);
  const args = [
    "--headless=new",
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--enable-unsafe-swiftshader",
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
    this.handlers = new Map();
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

  on(method, handler) {
    const handlers = this.handlers.get(method) ?? [];
    handlers.push(handler);
    this.handlers.set(method, handlers);
  }

  async send(method, params = {}) {
    if (!this.socket) {
      throw new Error("CDP session is not connected");
    }
    const id = this.nextId;
    this.nextId += 1;
    const payload = JSON.stringify({ id, method, params });
    this.sendFrame(0x1, Buffer.from(payload, "utf8"));
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
    if (message.id) {
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
      return;
    }

    if (message.method) {
      for (const handler of this.handlers.get(message.method) ?? []) {
        handler(message.params ?? {});
      }
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

function paethPredictor(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function pngStats(buffer) {
  const signature = "89504e470d0a1a0a";
  if (buffer.subarray(0, 8).toString("hex") !== signature) {
    throw new Error("Screenshot was not a PNG");
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];

  while (offset < buffer.byteLength) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = buffer.subarray(dataStart, dataEnd);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idat.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset = dataEnd + 4;
  }

  if (bitDepth !== 8 || ![0, 2, 6].includes(colorType)) {
    throw new Error(`Unsupported PNG format: bitDepth=${bitDepth}, colorType=${colorType}`);
  }

  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 1;
  const bpp = channels;
  const rowBytes = width * channels;
  const raw = inflateSync(Buffer.concat(idat));
  let rawOffset = 0;
  let prev = Buffer.alloc(rowBytes);
  const stepY = Math.max(1, Math.floor(height / 160));
  const stepX = Math.max(1, Math.floor(width / 120));
  let sampleCount = 0;
  let sum = 0;
  let sumSq = 0;
  let minLuma = 255;
  let maxLuma = 0;
  let chromaCount = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = raw[rawOffset];
    rawOffset += 1;
    const row = Buffer.from(raw.subarray(rawOffset, rawOffset + rowBytes));
    rawOffset += rowBytes;

    for (let x = 0; x < rowBytes; x += 1) {
      const left = x >= bpp ? row[x - bpp] : 0;
      const up = prev[x];
      const upLeft = x >= bpp ? prev[x - bpp] : 0;
      if (filter === 1) {
        row[x] = (row[x] + left) & 0xff;
      } else if (filter === 2) {
        row[x] = (row[x] + up) & 0xff;
      } else if (filter === 3) {
        row[x] = (row[x] + Math.floor((left + up) / 2)) & 0xff;
      } else if (filter === 4) {
        row[x] = (row[x] + paethPredictor(left, up, upLeft)) & 0xff;
      } else if (filter !== 0) {
        throw new Error(`Unsupported PNG filter ${filter}`);
      }
    }

    if (y % stepY === 0) {
      for (let x = 0; x < width; x += stepX) {
        const px = x * channels;
        const r = row[px];
        const g = colorType === 0 ? r : row[px + 1];
        const b = colorType === 0 ? r : row[px + 2];
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        sampleCount += 1;
        sum += luma;
        sumSq += luma * luma;
        minLuma = Math.min(minLuma, luma);
        maxLuma = Math.max(maxLuma, luma);
        if (Math.max(r, g, b) - Math.min(r, g, b) > 10) {
          chromaCount += 1;
        }
      }
    }

    prev = row;
  }

  const mean = sum / sampleCount;
  const variance = sumSq / sampleCount - mean * mean;
  return {
    width,
    height,
    mean,
    variance,
    lumaRange: maxLuma - minLuma,
    chromaRatio: chromaCount / sampleCount,
  };
}

function isMeaningfullyNonblank(pngBuffer) {
  const stats = pngStats(pngBuffer);
  const flatDark = stats.mean < 10 && stats.lumaRange < 8 && stats.variance < 10;
  const flatLight = stats.mean > 245 && stats.lumaRange < 8 && stats.variance < 10;
  if (flatDark || flatLight) {
    return { nonblank: false, stats };
  }
  return {
    nonblank: stats.lumaRange > 18 || stats.variance > 35 || stats.chromaRatio > 0.015,
    stats,
  };
}

async function getClip(cdp, selector) {
  if (!selector) return null;
  const expression = `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const width = Math.max(0, Math.min(rect.width, window.innerWidth - Math.max(0, rect.left)));
    const height = Math.max(0, Math.min(rect.height, window.innerHeight - Math.max(0, rect.top)));
    if (width < 2 || height < 2) return null;
    return {
      x: Math.max(0, rect.left),
      y: Math.max(0, rect.top),
      width,
      height,
      scale: 1
    };
  })()`;
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    returnByValue: true,
  });
  return result.result?.value ?? null;
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

async function applyProfile(cdp) {
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

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    usage();
    return;
  }
  assertFinitePositive(opts.timeoutMs, "--timeout-ms");
  assertFinitePositive(opts.pollMs, "--poll-ms");
  assertFinitePositive(opts.networkIdleMs, "--network-idle-ms");
  assertFinitePositive(opts.readyGraceMs, "--ready-grace-ms");

  const appDir = path.resolve(opts.appDir);
  const distDir = path.isAbsolute(opts.dist) ? opts.dist : path.join(appDir, opts.dist);

  if (opts.build) {
    await runCommand(opts.buildCommand, appDir);
  }
  if (!existsSync(path.join(distDir, "index.html"))) {
    throw new Error(`Expected built Vite app at ${path.join(distDir, "index.html")}`);
  }

  const dist = analyzeDist(distDir);
  const { server, origin } = await startGzipServer(distDir);
  const targetUrl = new URL(opts.path, `${origin}/`).toString();
  let chrome = null;
  let cdp = null;

  try {
    chrome = await launchChrome(opts);
    const version = await waitForJson(`http://127.0.0.1:${chrome.port}/json/version`, 10_000);
    cdp = new CdpSession(await pageWebSocketUrl(chrome.port));
    await cdp.connect();

    const requests = new Map();
    const inflight = new Set();
    let encodedBytes = 0;
    let completedRequests = 0;
    let failedRequests = 0;
    let lastNetworkAt = performance.now();
    let firstScriptFinished = false;

    cdp.on("Network.requestWillBeSent", (event) => {
      if (event.request?.url?.startsWith(origin)) {
        requests.set(event.requestId, {
          url: event.request.url,
          method: event.request.method,
          resourceType: event.type,
          status: null,
          encodedDataLength: 0,
        });
        inflight.add(event.requestId);
        lastNetworkAt = performance.now();
      }
    });
    cdp.on("Network.responseReceived", (event) => {
      const request = requests.get(event.requestId);
      if (request) {
        request.status = event.response?.status ?? null;
        request.mimeType = event.response?.mimeType ?? null;
      }
    });
    cdp.on("Network.loadingFinished", (event) => {
      const request = requests.get(event.requestId);
      if (request) {
        request.encodedDataLength = event.encodedDataLength ?? 0;
        encodedBytes += request.encodedDataLength;
        completedRequests += 1;
        if (request.resourceType === "Script") {
          firstScriptFinished = true;
        }
        inflight.delete(event.requestId);
        lastNetworkAt = performance.now();
      }
    });
    cdp.on("Network.loadingFailed", (event) => {
      if (requests.has(event.requestId)) {
        failedRequests += 1;
        inflight.delete(event.requestId);
        lastNetworkAt = performance.now();
      }
    });

    await applyProfile(cdp);
    const navStart = performance.now();
    await cdp.send("Page.navigate", { url: targetUrl });

    let firstNonBlankMs = null;
    let firstReadyMs = null;
    let firstNonBlankStats = null;
    let timeoutHit = false;

    while (performance.now() - navStart < opts.timeoutMs) {
      const elapsed = performance.now() - navStart;

      if (firstReadyMs === null && (await checkReady(cdp, opts.readyExpression))) {
        firstReadyMs = Math.round(elapsed);
      }

      if (firstNonBlankMs === null && firstScriptFinished) {
        const clip = await getClip(cdp, opts.canvasSelector);
        const screenshot = await cdp.send("Page.captureScreenshot", {
          format: "png",
          fromSurface: true,
          captureBeyondViewport: false,
          ...(clip ? { clip } : {}),
        });
        const detection = isMeaningfullyNonblank(Buffer.from(screenshot.data, "base64"));
        if (detection.nonblank) {
          firstNonBlankMs = Math.round(elapsed);
          firstNonBlankStats = detection.stats;
        }
      }

      const networkQuiet = inflight.size === 0 && performance.now() - lastNetworkAt >= opts.networkIdleMs;
      const readySettled =
        firstReadyMs !== null ||
        (firstNonBlankMs !== null && performance.now() - navStart - firstNonBlankMs >= opts.readyGraceMs);
      if (firstNonBlankMs !== null && networkQuiet && readySettled) {
        break;
      }

      await wait(opts.pollMs);
    }

    if (firstNonBlankMs === null) {
      timeoutHit = true;
    }

    const result = {
      measuredAt: new Date().toISOString(),
      chrome: version.Browser ?? null,
      url: targetUrl,
      profile: {
        viewportCssPixels: `${PROFILE.width}x${PROFILE.height}`,
        deviceScaleFactor: PROFILE.deviceScaleFactor,
        latencyMs: PROFILE.latencyMs,
        downloadThroughputBytesPerSecond: PROFILE.downloadKiBps * 1024,
        uploadThroughputBytesPerSecond: PROFILE.uploadKiBps * 1024,
        cpuSlowdown: PROFILE.cpuSlowdown,
      },
      dist,
      coldLoad: {
        encodedBytes,
        completedRequests,
        failedRequests,
        inflightRequestsAtEnd: inflight.size,
        firstNonBlankMs,
        readyMs: firstReadyMs,
        timeoutHit,
      },
      firstNonBlankStats,
      requestBreakdown: [...requests.values()]
        .sort((a, b) => b.encodedDataLength - a.encodedDataLength)
        .slice(0, 20),
      readyExpression: opts.readyExpression,
      notes: [
        "encodedBytes sums CDP Network.loadingFinished.encodedDataLength for requests served by the local gzip static server.",
        "dist.gzipBytes is the full built dist/ payload if every file is gzip-compressed.",
        "firstNonBlankMs polling starts after the first app script response completes, so static HTML/CSS paint is not counted.",
        "readyMs is null unless the app exposes the ready expression or one is passed with --ready-expression.",
      ],
    };

    if (opts.out) {
      const outPath = path.isAbsolute(opts.out) ? opts.out : path.join(appDir, opts.out);
      writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (cdp) {
      cdp.close();
    }
    await new Promise((resolve) => server.close(resolve));
    if (chrome) {
      await stopChrome(chrome);
    }
  }
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exit(1);
});
