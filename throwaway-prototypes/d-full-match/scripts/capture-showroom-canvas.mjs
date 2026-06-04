#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";

const DEFAULT_URL = "http://127.0.0.1:8065/";
const DEFAULT_WIDTH = 1600;
const DEFAULT_HEIGHT = 1000;

function parseArgs(argv) {
  const opts = {
    url: DEFAULT_URL,
    outDir: path.resolve("dist/canvas-snapshots"),
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    chrome: process.env.CHROME_BIN || "",
    showroomWaitMs: 7_000,
    zoomSteps: 0,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`Missing value for ${arg}`);
      return argv[index];
    };
    if (arg === "--url") opts.url = next();
    else if (arg === "--out-dir") opts.outDir = path.resolve(next());
    else if (arg === "--width") opts.width = Number(next());
    else if (arg === "--height") opts.height = Number(next());
    else if (arg === "--chrome") opts.chrome = next();
    else if (arg === "--showroom-wait-ms") opts.showroomWaitMs = Number(next());
    else if (arg === "--zoom-steps") opts.zoomSteps = Number(next());
    else throw new Error(`Unknown option: ${arg}`);
  }
  return opts;
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
        if (!address || typeof address === "string") reject(new Error("Unable to reserve a port"));
        else resolve(address.port);
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
  ].filter(Boolean);
  const match = candidates.find((candidate) => existsSync(candidate));
  if (!match) throw new Error("Chrome/Chromium was not found. Pass --chrome <path>.");
  return match;
}

async function waitForJson(url, timeoutMs) {
  const start = performance.now();
  let lastError = null;
  while (performance.now() - start < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) return await response.json();
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
  if (!page) throw new Error("No debuggable page target found");
  return page.webSocketDebuggerUrl;
}

async function launchChrome(opts) {
  const port = await getFreePort();
  const userDataDir = mkdtempSync(path.join(os.tmpdir(), "d-full-showroom-capture-"));
  const child = spawn(
    findChrome(opts.chrome),
    [
      "--headless=new",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--enable-unsafe-swiftshader",
      "--hide-scrollbars",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  child.stderr.on("data", () => {});
  await waitForJson(`http://127.0.0.1:${port}/json/version`, 10_000);
  return { child, port, userDataDir };
}

async function stopChrome(chrome) {
  if (chrome.child.exitCode === null && !chrome.child.killed) {
    const exited = new Promise((resolve) => chrome.child.once("exit", resolve));
    chrome.child.kill("SIGTERM");
    await Promise.race([exited, wait(2_000)]);
  }
  rmSync(chrome.userDataDir, { recursive: true, force: true });
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
    this.socket = net.createConnection({ host: ws.hostname, port: Number(ws.port || 80) });
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
        if (splitAt === -1) return;
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
        if (rest.byteLength > 0) this.handleData(rest);
        resolve();
      };
      this.socket.on("error", onError);
      this.socket.on("data", onData);
      this.socket.on("connect", () => {
        this.socket.write(
          [
            `GET ${ws.pathname}${ws.search} HTTP/1.1`,
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
    if (!this.socket) throw new Error("CDP session is not connected");
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
    if (this.socket) this.socket.end();
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
        if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("WebSocket frame too large");
        length = Number(bigLength);
        offset += 8;
      }
      const maskOffset = offset;
      if (masked) offset += 4;
      if (this.buffer.byteLength < offset + length) return;
      let payload = this.buffer.subarray(offset, offset + length);
      if (masked) {
        const mask = this.buffer.subarray(maskOffset, maskOffset + 4);
        payload = Buffer.from(payload);
        for (let index = 0; index < payload.byteLength; index += 1) {
          payload[index] ^= mask[index % 4];
        }
      }
      this.buffer = this.buffer.subarray(offset + length);
      if (opcode === 0x1) this.handleMessage(payload.toString("utf8"));
      else if (opcode === 0x8) this.close();
      else if (opcode === 0x9) this.sendFrame(0xa, payload);
    }
  }

  handleMessage(text) {
    const message = JSON.parse(text);
    if (!message.id) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
    else pending.resolve(message.result ?? {});
  }

  sendFrame(opcode, payload) {
    const length = payload.byteLength;
    let headerLength = 2;
    if (length >= 126 && length <= 65_535) headerLength += 2;
    else if (length > 65_535) headerLength += 8;
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
    }
    const mask = randomBytes(4);
    const maskedPayload = Buffer.from(payload);
    for (let index = 0; index < maskedPayload.byteLength; index += 1) {
      maskedPayload[index] ^= mask[index % 4];
    }
    this.socket.write(Buffer.concat([header, mask, maskedPayload]));
  }
}

async function waitForExpression(cdp, expression, timeoutMs, label) {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    const result = await cdp.send("Runtime.evaluate", {
      expression: `(() => { try { return Boolean(${expression}); } catch { return false; } })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.result?.value === true) return;
    await wait(250);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function canvasClip(cdp) {
  const result = await cdp.send("Runtime.evaluate", {
    expression: `(() => {
      const canvas = document.querySelector("canvas");
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      return { x: rect.left, y: rect.top, width: rect.width, height: rect.height, scale: 1 };
    })()`,
    returnByValue: true,
  });
  const clip = result.result?.value ?? null;
  if (!clip || clip.width < 2 || clip.height < 2) throw new Error("Unable to locate canvas clip");
  return clip;
}

async function capture(cdp, outputPath, clip) {
  const screenshot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
    clip,
  });
  writeFileSync(outputPath, Buffer.from(screenshot.data, "base64"));
}

async function click(cdp, x, y) {
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "none" });
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

async function zoomIn(cdp, x, y, steps) {
  const count = Math.max(0, Math.floor(steps));
  for (let index = 0; index < count; index += 1) {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x,
      y,
      deltaX: 0,
      deltaY: -420,
    });
    await wait(120);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!Number.isFinite(opts.width) || !Number.isFinite(opts.height)) {
    throw new Error("--width and --height must be numbers");
  }
  mkdirSync(opts.outDir, { recursive: true });
  let chrome = null;
  let cdp = null;
  try {
    chrome = await launchChrome(opts);
    cdp = new CdpSession(await pageWebSocketUrl(chrome.port));
    await cdp.connect();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: opts.width,
      height: opts.height,
      deviceScaleFactor: 1,
      mobile: false,
      screenWidth: opts.width,
      screenHeight: opts.height,
    });
    await cdp.send("Page.navigate", { url: opts.url });
    await waitForExpression(cdp, 'window.__d_full_match_state === "picker_ready"', 30_000, "picker_ready");
    await wait(500);
    await click(cdp, opts.width - 86, 48);
    await wait(opts.showroomWaitMs);
    if (opts.zoomSteps > 0) {
      await zoomIn(cdp, opts.width * 0.5, opts.height * 0.56, opts.zoomSteps);
      await wait(1_000);
    }

    const full = await canvasClip(cdp);
    const lowerY = full.y + Math.min(226, full.height * 0.25);
    const lowerHeight = Math.max(2, full.height - (lowerY - full.y));
    const leftClip = {
      x: full.x,
      y: lowerY,
      width: full.width * 0.5,
      height: lowerHeight,
      scale: 1,
    };
    const rightClip = {
      x: full.x + full.width * 0.5,
      y: lowerY,
      width: full.width * 0.5,
      height: lowerHeight,
      scale: 1,
    };
    const outputs = {
      both: path.join(opts.outDir, "showroom-canvas-both.png"),
      experiment: path.join(opts.outDir, "showroom-canvas-experiment.png"),
      glitch_reaper: path.join(opts.outDir, "showroom-canvas-glitch_reaper.png"),
    };
    await capture(cdp, outputs.both, full);
    await capture(cdp, outputs.experiment, leftClip);
    await capture(cdp, outputs.glitch_reaper, rightClip);
    console.log(JSON.stringify({ url: opts.url, outputs, fullClip: full, cropY: lowerY }, null, 2));
  } finally {
    if (cdp) cdp.close();
    if (chrome) await stopChrome(chrome);
  }
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exit(1);
});
