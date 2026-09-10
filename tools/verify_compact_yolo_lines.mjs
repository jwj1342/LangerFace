import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { resolve } from 'node:path';

import { extractFineWrinkleLines } from '../web/src/services/personalized/fineWrinkleLines.ts';

const fixtureDirectory = process.argv[2];
const outputPath = process.argv[3];
const baseUrl = process.argv[4] || 'http://127.0.0.1:19420';
if (!fixtureDirectory || !outputPath) {
  throw new Error('Usage: node tools/verify_compact_yolo_lines.mjs FIXTURES OUTPUT_JSON [BASE_URL]');
}

const fixtures = resolve(fixtureDirectory);
const manifest = JSON.parse(await readFile(resolve(fixtures, 'manifest.json'), 'utf8'));
const samples = [];
for (const frame of manifest.frames) {
  const directory = resolve(fixtures, frame.id);
  const reference = JSON.parse(await readFile(resolve(directory, 'reference.json'), 'utf8'));
  const input = await readFile(resolve(directory, 'input.f32'));
  const requestStarted = performance.now();
  const response = await fetch(`${baseUrl}/api/gpu/yolo/class-masks`, {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: input,
  });
  assert.equal(response.status, 200);
  const payload = Buffer.from(await response.arrayBuffer());
  const requestMs = performance.now() - requestStarted;
  const headerSize = payload.readUInt32LE(0);
  const metadata = JSON.parse(payload.subarray(4, 4 + headerSize).toString());
  const pixels = metadata.width * metadata.height;
  const masks = {};
  let offset = 4 + headerSize;
  for (const name of metadata.classes) {
    masks[name] = new Uint8Array(payload.buffer.slice(
      payload.byteOffset + offset,
      payload.byteOffset + offset + pixels,
    ));
    offset += pixels;
  }
  assert.equal(offset, payload.byteLength);
  const linesStarted = performance.now();
  const extracted = extractFineWrinkleLines(masks, metadata.width, metadata.height, {
    minimumLineLengthPx: 20,
    resampleSpacingPx: 1,
    maximumSkeletonIterations: 96,
    sourceImageRgba: undefined,
  });
  const linesMs = performance.now() - linesStarted;
  assert.equal(extracted.validation.passed, true);
  assert.deepEqual(extracted.lines, reference.lines, `Line geometry changed for ${frame.id}`);
  samples.push({ id: frame.id, requestMs, linesMs, totalMs: requestMs + linesMs,
    inferenceMs: metadata.inferenceMs, postprocessMs: metadata.postprocessMs,
    responseBytes: payload.byteLength, lineCount: extracted.lines.length });
}

function distribution(key) {
  const values = samples.map(sample => sample[key]).sort((left, right) => left - right);
  const at = fraction => values[Math.min(values.length - 1, Math.floor((values.length - 1) * fraction))];
  return { median: at(0.5), p95: at(0.95), min: values[0], max: values.at(-1) };
}

const report = {
  schemaVersion: 'langerface.compact-yolo-lines-verification.v1',
  frameCount: samples.length,
  exactLineFrameCount: samples.length,
  exactLineGeometry: true,
  responseBytes: samples[0].responseBytes,
  timings: Object.fromEntries(['requestMs', 'inferenceMs', 'postprocessMs', 'linesMs', 'totalMs']
    .map(key => [key, distribution(key)])),
  samples,
};
await writeFile(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ ...report, samples: undefined }));
