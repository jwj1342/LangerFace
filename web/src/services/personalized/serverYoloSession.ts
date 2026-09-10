// Server builds use the resident CUDA session, while reusing the same decode code.
export class ServerTensor {
  type: string;
  data: Float32Array;
  dims: readonly number[];
  constructor(type: string, data: Float32Array, dims: readonly number[]) {
    this.type = type; this.data = data; this.dims = dims;
  }
  dispose(): void {}
}

export async function createServerYoloSession(expectedSha256: string) {
  const healthResponse = await fetch('/api/gpu/health', { signal: AbortSignal.timeout(10000) });
  if (!healthResponse.ok) throw new Error(`CUDA service unavailable: ${healthResponse.status}`);
  const health = await healthResponse.json();
  if (!health.ready || health.yoloProvider !== 'CUDAExecutionProvider'
    || health.modelSha256 !== expectedSha256.toLowerCase()) {
    throw new Error('CUDA model backend or checksum mismatch');
  }
  return {
    inputNames: ['images'],
    async run(feeds: Record<string, { data: Float32Array }>) {
      const input = feeds.images.data;
      let response: Response | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        response = await fetch('/api/gpu/yolo/tensor', {
          method: 'POST', headers: { 'Content-Type': 'application/octet-stream' },
          body: new Uint8Array(input.buffer as ArrayBuffer, input.byteOffset, input.byteLength),
          signal: AbortSignal.timeout(30000),
        });
        if (response.status !== 429 || attempt === 2) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      if (!response) throw new Error('CUDA inference unavailable');
      if (!response.ok) throw new Error(`CUDA inference failed: ${response.status}`);
      const buffer = await response.arrayBuffer();
      const headerLength = new DataView(buffer).getUint32(0, true);
      if (headerLength > buffer.byteLength - 4) throw new Error('Invalid CUDA response');
      const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headerLength)));
      if (header.modelSha256 !== expectedSha256.toLowerCase()) throw new Error('CUDA model changed');
      let offset = 4 + headerLength;
      const outputs: Record<string, ServerTensor> = {};
      for (const output of header.outputs) {
        if (output.dtype !== 'float32' || !Number.isSafeInteger(output.bytes)
          || output.bytes < 0 || output.bytes % 4 || offset + output.bytes > buffer.byteLength
          || !Array.isArray(output.shape)
          || output.shape.some((dimension: number) => !Number.isSafeInteger(dimension) || dimension <= 0)
          || output.shape.reduce((count: number, dimension: number) => count * dimension, 1) !== output.bytes / 4) {
          throw new Error('Invalid CUDA tensor');
        }
        outputs[output.name] = new ServerTensor('float32',
          new Float32Array(buffer.slice(offset, offset + output.bytes)), output.shape);
        offset += output.bytes;
      }
      if (offset !== buffer.byteLength) throw new Error('Unexpected CUDA response data');
      return outputs;
    },
    async runClassMasks(input: Float32Array) {
      let response: Response | undefined;
      for (let attempt = 0; attempt < 3; attempt++) {
        response = await fetch('/api/gpu/yolo/class-masks', {
          method: 'POST', headers: { 'Content-Type': 'application/octet-stream' },
          body: new Uint8Array(input.buffer as ArrayBuffer, input.byteOffset, input.byteLength),
          signal: AbortSignal.timeout(30000),
        });
        if (response.status !== 429 || attempt === 2) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      if (!response?.ok) throw new Error(`CUDA compact inference failed: ${response?.status ?? 'unavailable'}`);
      return parseCompactMaskResponse(await response.arrayBuffer(), expectedSha256);
    },
    async runClassMasksImageData(imageData: ImageData) {
      if (imageData.width !== 640 || imageData.height !== 640
          || imageData.data.byteLength !== 640 * 640 * 4) {
        throw new Error('CUDA RGBA compact inference requires a 640x640 frame');
      }
      let response: Response | undefined;
      const body: BodyInit = new Uint8Array(
        imageData.data.buffer as ArrayBuffer,
        imageData.data.byteOffset,
        imageData.data.byteLength,
      );
      for (let attempt = 0; attempt < 3; attempt++) {
        response = await fetch('/api/gpu/yolo/class-masks-rgba', {
          method: 'POST', headers: { 'Content-Type': 'application/octet-stream' },
          body,
          signal: AbortSignal.timeout(30000),
        });
        if (response.status !== 429 || attempt === 2) break;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      if (!response?.ok) throw new Error(`CUDA compact RGBA inference failed: ${response?.status ?? 'unavailable'}`);
      return parseCompactMaskResponse(await response.arrayBuffer(), expectedSha256);
    },
    async release() {},
  };
}

function parseCompactMaskResponse(buffer: ArrayBuffer, expectedSha256: string) {
  const headerLength = new DataView(buffer).getUint32(0, true);
  if (headerLength > buffer.byteLength - 4) throw new Error('Invalid compact CUDA response');
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headerLength)));
  if (header.modelSha256 !== expectedSha256.toLowerCase()) throw new Error('CUDA model changed');
  if (header.width !== 640 || header.height !== 640
      || JSON.stringify(header.classes) !== JSON.stringify(['forehead', 'frown', 'wrinkle'])) {
    throw new Error('Invalid compact mask metadata');
  }
  const pixels = header.width * header.height;
  let offset = 4 + headerLength;
  const classMasks: Record<string, Uint8Array> = {};
  if (header.maskEncoding === 'bitpack-msb') {
    const totalPixels = pixels * header.classes.length;
    const packedBytes = Math.ceil(totalPixels / 8);
    if (header.unpackedMaskBytes !== totalPixels || offset + packedBytes !== buffer.byteLength) {
      throw new Error('Invalid packed compact mask payload');
    }
    const packed = new Uint8Array(buffer, offset, packedBytes);
    for (let classIndex = 0; classIndex < header.classes.length; classIndex++) {
      const mask = new Uint8Array(pixels);
      const base = classIndex * pixels;
      for (let index = 0; index < pixels; index++) {
        const bitIndex = base + index;
        mask[index] = (packed[bitIndex >> 3] >> (7 - (bitIndex & 7))) & 1;
      }
      classMasks[header.classes[classIndex]] = mask;
    }
    offset += packedBytes;
  } else {
  for (const name of header.classes) {
    if (offset + pixels > buffer.byteLength) throw new Error('Invalid compact mask payload');
    classMasks[name] = new Uint8Array(buffer.slice(offset, offset + pixels));
    offset += pixels;
  }
  }
  if (offset !== buffer.byteLength || !Array.isArray(header.detections)) {
    throw new Error('Unexpected compact CUDA response data');
  }
  return {
    width: header.width,
    height: header.height,
    classMasks,
    detections: header.detections,
    diagnostics: {
      candidateCount: header.candidateCount,
      detectionCount: header.detectionCount,
      confidenceThreshold: 0.07,
      iouThreshold: 0.45,
      maskThreshold: 0.5,
      preprocessingMs: header.preprocessingMs,
      inferenceMs: header.inferenceMs,
      postprocessMs: header.postprocessMs,
    },
  };
}
