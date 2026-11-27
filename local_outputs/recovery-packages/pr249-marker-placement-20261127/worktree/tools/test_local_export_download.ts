import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import { localExportDownloadPlugin } from "../web/dev/localExportDownloadPlugin.ts";

let middleware: ((req: any, res: any, next: () => void) => void) | null = null;
localExportDownloadPlugin().configureServer?.({
  middlewares: { use(value: typeof middleware) { middleware = value; } },
} as any);
assert.ok(middleware);

function response() {
  const headers = new Map<string, string>();
  let body = Buffer.alloc(0);
  return {
    headers,
    get body() { return body; },
    setHeader(name: string, value: string) { headers.set(name.toLowerCase(), String(value)); },
    end(value?: string | Buffer) { body = Buffer.isBuffer(value) ? value : Buffer.from(value || ""); },
    statusCode: 200,
  };
}

const upload = Object.assign(new EventEmitter(), {
  url: "/__local-export?filename=test.png", method: "POST",
  headers: { "content-type": "image/png", "content-length": "4" },
});
const uploadResponse = response();
middleware!(upload, uploadResponse, () => assert.fail("upload must be handled"));
upload.emit("data", Buffer.from([1, 2, 3, 4]));
upload.emit("end");
const payload = JSON.parse(uploadResponse.body.toString());
assert.match(payload.download_url, /^\/__local-export\/[0-9a-f-]+$/);

const downloadResponse = response();
middleware!({ url: payload.download_url, method: "GET", headers: {} }, downloadResponse, () => assert.fail("download must be handled"));
assert.deepEqual([...downloadResponse.body], [1, 2, 3, 4]);
assert.equal(downloadResponse.headers.get("content-type"), "application/octet-stream");
assert.equal(downloadResponse.headers.get("x-content-type-options"), "nosniff");
assert.equal(downloadResponse.headers.get("content-disposition"), 'attachment; filename="test.png"');

const videoUpload = Object.assign(new EventEmitter(), {
  url: "/__local-export?filename=test.webm", method: "POST",
  headers: { "content-type": "video/webm", "content-length": "4" },
});
const videoUploadResponse = response();
middleware!(videoUpload, videoUploadResponse, () => assert.fail("video upload must be handled"));
videoUpload.emit("data", Buffer.from([5, 6, 7, 8]));
videoUpload.emit("end");
const videoPayload = JSON.parse(videoUploadResponse.body.toString());
const videoDownloadResponse = response();
middleware!({ url: videoPayload.download_url, method: "GET", headers: {} }, videoDownloadResponse, () => assert.fail("video download must be handled"));
assert.equal(videoDownloadResponse.headers.get("content-type"), "video/webm");
assert.equal(videoDownloadResponse.headers.get("content-disposition"), 'attachment; filename="test.webm"');
console.log("test_local_export_download: in-memory upload and attachment download passed");
