import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, before, describe, test } from "node:test";

import {
  contentTypeFor,
  createStaticServer,
  resolveRequestPath
} from "../server.mjs";

describe("contentTypeFor", () => {
  test("returns browser-friendly MIME types for known extensions", () => {
    assert.equal(contentTypeFor("index.html"), "text/html; charset=utf-8");
    assert.equal(contentTypeFor("app.js"), "text/javascript; charset=utf-8");
    assert.equal(contentTypeFor("manifest.webmanifest"), "application/manifest+json; charset=utf-8");
    assert.equal(contentTypeFor("ICON.SVG"), "image/svg+xml; charset=utf-8");
    assert.equal(contentTypeFor("vision.wasm"), "application/wasm");
  });

  test("falls back to an opaque binary type", () => {
    assert.equal(contentTypeFor("recording.unknown"), "application/octet-stream");
  });
});

describe("resolveRequestPath", () => {
  const fixtureRoot = resolve("/tmp/wricord-resolution-fixture");

  test("routes only the entry point, source tree, and public assets", () => {
    assert.equal(resolveRequestPath("/", fixtureRoot), join(fixtureRoot, "index.html"));
    assert.equal(resolveRequestPath("/index.html?fresh=1", fixtureRoot), join(fixtureRoot, "index.html"));
    assert.equal(resolveRequestPath("/src/app.js", fixtureRoot), join(fixtureRoot, "src/app.js"));
    assert.equal(resolveRequestPath("/icon.svg", fixtureRoot), join(fixtureRoot, "public/icon.svg"));
    assert.equal(
      resolveRequestPath("/vendor/mediapipe/vision_bundle.mjs", fixtureRoot),
      join(fixtureRoot, "node_modules/@mediapipe/tasks-vision/vision_bundle.mjs"),
    );
    assert.equal(resolveRequestPath("/vendor/mediapipe/package.json", fixtureRoot), null);
  });

  test("contains traversal attempts and rejects malformed paths", () => {
    const literalTraversal = resolveRequestPath("/../../server.mjs", fixtureRoot);
    const encodedTraversal = resolveRequestPath("/src/%2e%2e/%2e%2e/server.mjs", fixtureRoot);

    assert.equal(literalTraversal, join(fixtureRoot, "public/server.mjs"));
    assert.equal(encodedTraversal, join(fixtureRoot, "public/server.mjs"));
    assert.equal(resolveRequestPath("/%E0%A4%A", fixtureRoot), null);
    assert.equal(resolveRequestPath("/%5C..%5Csecret", fixtureRoot), null);
  });
});

describe("createStaticServer", () => {
  let fixtureRoot;
  let server;
  let baseUrl;

  before(async () => {
    fixtureRoot = await mkdtemp(join(tmpdir(), "wricord-server-test-"));
    await mkdir(join(fixtureRoot, "src"));
    await mkdir(join(fixtureRoot, "public"));
    await mkdir(
      join(fixtureRoot, "node_modules/@mediapipe/tasks-vision/wasm"),
      { recursive: true },
    );
    await writeFile(join(fixtureRoot, "index.html"), "<!doctype html><title>Wricord</title>");
    await writeFile(join(fixtureRoot, "src/app.js"), "export const ready = true;\n");
    await writeFile(join(fixtureRoot, "public/icon.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"/>\n");
    await writeFile(
      join(
        fixtureRoot,
        "node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_module_internal.wasm",
      ),
      new Uint8Array([0, 97, 115, 109]),
    );

    server = createStaticServer({ rootDirectory: fixtureRoot });
    await new Promise((resolvePromise, rejectPromise) => {
      server.once("error", rejectPromise);
      server.listen(0, "127.0.0.1", resolvePromise);
    });

    const address = server.address();
    assert(address && typeof address === "object");
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(async () => {
    if (server?.listening) {
      await new Promise((resolvePromise, rejectPromise) => {
        server.close((error) => error ? rejectPromise(error) : resolvePromise());
      });
    }

    if (fixtureRoot) {
      await rm(fixtureRoot, { force: true, recursive: true });
    }
  });

  test("serves GET requests from the intended roots", async () => {
    const entryResponse = await fetch(`${baseUrl}/`);
    assert.equal(entryResponse.status, 200);
    assert.match(entryResponse.headers.get("content-type"), /^text\/html/);
    assert.match(entryResponse.headers.get("content-security-policy"), /connect-src 'self'/);
    assert.doesNotMatch(
      entryResponse.headers.get("content-security-policy"),
      /https:|googleapis/,
    );
    assert.equal(await entryResponse.text(), "<!doctype html><title>Wricord</title>");

    const publicResponse = await fetch(`${baseUrl}/icon.svg`);
    assert.equal(publicResponse.status, 200);
    assert.match(publicResponse.headers.get("content-type"), /^image\/svg\+xml/);

    const wasmResponse = await fetch(
      `${baseUrl}/vendor/mediapipe/wasm/vision_wasm_module_internal.wasm`,
    );
    assert.equal(wasmResponse.status, 200);
    assert.equal(wasmResponse.headers.get("content-type"), "application/wasm");

    const blockedVendorResponse = await fetch(`${baseUrl}/vendor/mediapipe/package.json`);
    assert.equal(blockedVendorResponse.status, 400);
  });

  test("serves HEAD without a response body", async () => {
    const response = await fetch(`${baseUrl}/src/app.js`, { method: "HEAD" });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-length"), String(Buffer.byteLength("export const ready = true;\n")));
    assert.equal(await response.text(), "");
  });

  test("rejects unsupported methods", async () => {
    const response = await fetch(`${baseUrl}/`, { method: "POST" });

    assert.equal(response.status, 405);
    assert.equal(response.headers.get("allow"), "GET, HEAD");
    assert.equal(await response.text(), "Method not allowed");
  });
});
