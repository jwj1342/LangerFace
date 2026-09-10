import readline from 'node:readline';
import { performance } from 'node:perf_hooks';
import { YoloWrinkleOnnx, YOLO_WRINKLE_MODEL_SHA256 } from '../../web/src/services/personalized/yoloWrinkleOnnx.ts';
import { extractFineWrinkleLines } from '../../web/src/services/personalized/fineWrinkleLines.ts';

class Tensor {
  constructor(type, data, dims) { Object.assign(this, { type, data, dims }); }
  dispose() {}
}
let inferenceMs = 0;
const session = {
  inputNames: ['images'],
  async run(feeds) {
    const input = feeds.images.data;
    const response = await fetch(`http://127.0.0.1:${process.env.LANGERFACE_PORT || '19420'}/api/gpu/yolo/tensor`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' },
      body: Buffer.from(input.buffer, input.byteOffset, input.byteLength),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`CUDA inference HTTP ${response.status}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    const headerSize = buffer.readUInt32LE(0);
    const header = JSON.parse(buffer.subarray(4, 4+headerSize).toString());
    if (header.modelSha256 !== YOLO_WRINKLE_MODEL_SHA256.toLowerCase()) throw new Error('Model checksum mismatch');
    inferenceMs = header.inferenceMs;
    let offset = 4+headerSize;
    const outputs = {};
    for (const output of header.outputs) {
      const bytes = buffer.subarray(offset, offset+output.bytes);
      const data = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset+bytes.byteLength));
      outputs[output.name] = new Tensor('float32', data, output.shape);
      offset += output.bytes;
    }
    if (offset !== buffer.length) throw new Error('Invalid CUDA response size');
    return outputs;
  },
};
const detector = new YoloWrinkleOnnx({ session, runtime: { Tensor } });
for await (const line of readline.createInterface({ input: process.stdin, crlfDelay: Infinity })) {
  try {
    const request = JSON.parse(line);
    const bytes = Buffer.from(request.rgba, 'base64');
    if (bytes.length !== request.width*request.height*4) throw new Error('Invalid RGBA length');
    const image = { data: new Uint8ClampedArray(bytes), width: request.width, height: request.height };
    const start = performance.now();
    const detection = await detector.detect(image);
    const detected = performance.now();
    const extracted = extractFineWrinkleLines(detection.classMasks, image.width, image.height, {
      minimumLineLengthPx: 20, resampleSpacingPx: 1, maximumSkeletonIterations: 96,
      sourceImageRgba: undefined,
    });
    const done = performance.now();
    process.stdout.write(JSON.stringify({ ok: true, width: image.width, height: image.height,
      modelSha256: YOLO_WRINKLE_MODEL_SHA256.toLowerCase(), lines: extracted.lines,
      validation: extracted.validation, diagnostics: detection.diagnostics,
      timings: { detectMs: detected-start, inferenceMs, linesMs: done-detected, workerMs: done-start },
    })+'\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: String(error) })+'\n');
  }
}
