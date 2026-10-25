import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const defaultPort = 4173;
const contentSecurityPolicy = [
  "base-uri 'none'",
  "connect-src 'self'",
  "default-src 'self'",
  "font-src 'self'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "object-src 'none'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "worker-src 'self'"
].join("; ");

const mediapipeAssets = new Map([
  ["/vendor/mediapipe/vision_bundle.mjs", "vision_bundle.mjs"],
  ["/vendor/mediapipe/wasm/vision_wasm_internal.js", "wasm/vision_wasm_internal.js"],
  ["/vendor/mediapipe/wasm/vision_wasm_internal.wasm", "wasm/vision_wasm_internal.wasm"],
  [
    "/vendor/mediapipe/wasm/vision_wasm_module_internal.js",
    "wasm/vision_wasm_module_internal.js"
  ],
  [
    "/vendor/mediapipe/wasm/vision_wasm_module_internal.wasm",
    "wasm/vision_wasm_module_internal.wasm"
  ],
  [
    "/vendor/mediapipe/wasm/vision_wasm_nosimd_internal.js",
    "wasm/vision_wasm_nosimd_internal.js"
  ],
  [
    "/vendor/mediapipe/wasm/vision_wasm_nosimd_internal.wasm",
    "wasm/vision_wasm_nosimd_internal.wasm"
  ]
]);

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml; charset=utf-8"],
  [".wasm", "application/wasm"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".woff2", "font/woff2"]
]);

export function contentTypeFor(filePath) {
  return contentTypes.get(extname(filePath).toLowerCase()) ?? "application/octet-stream";
}

function resolveWithin(baseDirectory, requestPath) {
  const candidate = resolve(baseDirectory, `.${requestPath}`);
  const pathFromBase = relative(baseDirectory, candidate);

  if (pathFromBase === "" || pathFromBase.startsWith("..") || isAbsolute(pathFromBase)) {
    return null;
  }

  return candidate;
}

export function resolveRequestPath(requestTarget, rootDirectory = projectRoot) {
  let pathname;

  try {
    pathname = decodeURIComponent(new URL(requestTarget, "http://localhost").pathname);
  } catch {
    return null;
  }

  if (pathname.includes("\0") || pathname.includes("\\")) {
    return null;
  }

  if (pathname === "/" || pathname === "/index.html") {
    return resolve(rootDirectory, "index.html");
  }

  const mediapipeAsset = mediapipeAssets.get(pathname);
  if (mediapipeAsset) {
    return resolve(
      rootDirectory,
      "node_modules",
      "@mediapipe",
      "tasks-vision",
      mediapipeAsset
    );
  }

  if (pathname.startsWith("/vendor/mediapipe/")) {
    return null;
  }

  if (pathname.startsWith("/src/")) {
    return resolveWithin(rootDirectory, pathname);
  }

  return resolveWithin(resolve(rootDirectory, "public"), pathname);
}

function sendText(response, statusCode, message, requestMethod = "GET") {
  response.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Security-Policy": contentSecurityPolicy,
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff"
  });

  response.end(requestMethod === "HEAD" ? undefined : message);
}

export function createStaticServer({ rootDirectory = projectRoot } = {}) {
  return createServer(async (request, response) => {
    const requestMethod = request.method ?? "GET";

    if (requestMethod !== "GET" && requestMethod !== "HEAD") {
      response.setHeader("Allow", "GET, HEAD");
      sendText(response, 405, "Method not allowed", requestMethod);
      return;
    }

    const filePath = resolveRequestPath(request.url ?? "/", rootDirectory);

    if (!filePath) {
      sendText(response, 400, "Bad request", requestMethod);
      return;
    }

    try {
      const fileStats = await stat(filePath);

      if (!fileStats.isFile()) {
        sendText(response, 404, "Not found", requestMethod);
        return;
      }

      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Security-Policy": contentSecurityPolicy,
        "Content-Length": fileStats.size,
        "Content-Type": contentTypeFor(filePath),
        "Permissions-Policy": "camera=(self), microphone=(self)",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff"
      });

      if (requestMethod === "HEAD") {
        response.end();
        return;
      }

      const stream = createReadStream(filePath);
      stream.on("error", () => response.destroy());
      stream.pipe(response);
    } catch (error) {
      if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
        sendText(response, 404, "Not found", requestMethod);
        return;
      }

      sendText(response, 500, "Internal server error", requestMethod);
    }
  });
}

function readPort(value) {
  if (value === undefined) {
    return defaultPort;
  }

  const parsedPort = Number(value);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
    throw new Error(`Invalid PORT: ${value}`);
  }

  return parsedPort;
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : "";
const isMainModule = entryPath === fileURLToPath(import.meta.url);

if (isMainModule) {
  const port = readPort(process.env.PORT);
  const server = createStaticServer();

  server.listen(port, "127.0.0.1", () => {
    console.log(`Wricord is ready at http://localhost:${port}`);
  });
}
