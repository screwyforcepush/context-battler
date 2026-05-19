#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(scriptDir, "..");

const opts = {
  host: "127.0.0.1",
  port: 8062,
  dist: path.join(appDir, "dist"),
  open: false,
  gzip: false,
};

for (let i = 2; i < process.argv.length; i += 1) {
  const arg = process.argv[i];
  if (arg === "--open") opts.open = true;
  else if (arg === "--gzip") opts.gzip = true;
  else if (arg === "--host") opts.host = process.argv[++i] ?? opts.host;
  else if (arg === "--port") opts.port = Number(process.argv[++i] ?? opts.port);
  else if (arg === "--dist") opts.dist = path.resolve(appDir, process.argv[++i] ?? opts.dist);
  else if (arg === "--help" || arg === "-h") {
    console.log("Usage: npm run serve -- [--open] [--gzip] [--host 127.0.0.1] [--port 8062] [--dist dist]");
    process.exit(0);
  } else {
    throw new Error(`Unknown option: ${arg}`);
  }
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".js" || ext === ".mjs") return "text/javascript; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".glb") return "model/gltf-binary";
  if (ext === ".pck") return "application/octet-stream";
  if (ext === ".wasm") return "application/wasm";
  return "application/octet-stream";
}

function safeStaticPath(root, requestUrl) {
  const url = new URL(requestUrl, "http://localhost");
  let pathname = decodeURIComponent(url.pathname);
  if (pathname.endsWith("/")) pathname += "index.html";
  const fullPath = path.resolve(root, `.${pathname}`);
  const relative = path.relative(root, fullPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
  if (existsSync(fullPath) && statSync(fullPath).isDirectory()) {
    return path.join(fullPath, "index.html");
  }
  return fullPath;
}

if (!existsSync(opts.dist)) {
  throw new Error(`Missing dist at ${opts.dist}. Run npm run build first.`);
}

const server = createServer((req, res) => {
  const filePath = safeStaticPath(opts.dist, req.url ?? "/");
  const headers = {
    "Cache-Control": "no-store",
    "Cross-Origin-Embedder-Policy": "require-corp",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Cross-Origin-Resource-Policy": "cross-origin",
  };

  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    res.writeHead(404, { ...headers, "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const raw = readFileSync(filePath);
  const wantsGzip = opts.gzip && /\bgzip\b/.test(req.headers["accept-encoding"] ?? "");
  if (wantsGzip) {
    const encoded = gzipSync(raw, { level: 9 });
    res.writeHead(200, {
      ...headers,
      "Content-Encoding": "gzip",
      "Content-Length": String(encoded.byteLength),
      "Content-Type": contentType(filePath),
      Vary: "Accept-Encoding",
    });
    res.end(encoded);
    return;
  }

  res.writeHead(200, {
    ...headers,
    "Content-Length": String(raw.byteLength),
    "Content-Type": contentType(filePath),
  });
  res.end(raw);
});

server.listen(opts.port, opts.host, () => {
  const url = `http://${opts.host}:${opts.port}/`;
  console.log(`Godot WASM prototype served at ${url}`);
  console.log("Headers: Cross-Origin-Opener-Policy=same-origin, Cross-Origin-Embedder-Policy=require-corp");
  if (opts.open) {
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
    const child = spawn(opener, args, { stdio: "ignore", detached: true });
    child.unref();
  }
});
