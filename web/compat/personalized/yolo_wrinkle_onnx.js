/**
 * Browser-side YOLOv8-seg wrinkle inference.
 *
 * The exported helpers intentionally avoid DOM and ONNX Runtime dependencies
 * so preprocessing, decode, NMS and mask cleanup can be exercised in Node.
 * `YoloWrinkleOnnx` loads onnxruntime-web lazily when inference is requested.
 */

export const YOLO_WRINKLE_ONNX_VERSION = "yolov8-seg-browser-0.1.0";
export const YOLO_WRINKLE_CLASSES = Object.freeze(["forehead", "frown", "wrinkle"]);
export const YOLO_WRINKLE_INPUT_SIZE = 640;
export const YOLO_WRINKLE_CONFIDENCE = 0.07;
// These values describe the checked-in four-part browser artifact. They are
// intentionally verified independently of the source PyTorch checkpoint.
export const YOLO_WRINKLE_MODEL_BYTES = 47_378_404;
export const YOLO_WRINKLE_MODEL_SHA256 =
  "4BB6ECD9C5FDDDDF1A4559813FB40293F6AE552EA1287912219157B91408A744";

// `new URL(..., import.meta.url)` works in Node tests, Vite development and
// Vite production builds without teaching Node how to import the binary parts.
export const DEFAULT_MODEL_CHUNK_URLS = Object.freeze([
  new URL("./model/wrinkle-yolov8s-seg-640.onnx.part00", import.meta.url).href,
  new URL("./model/wrinkle-yolov8s-seg-640.onnx.part01", import.meta.url).href,
  new URL("./model/wrinkle-yolov8s-seg-640.onnx.part02", import.meta.url).href,
  new URL("./model/wrinkle-yolov8s-seg-640.onnx.part03", import.meta.url).href,
]);

const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));

function assertPositiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) throw new TypeError(`${label} must be a positive integer`);
}

function maskEnabled(mask, index) {
  return !!mask && Number(mask[index] || 0) > 0;
}

function skinAllows(mask, index) {
  return !mask || maskEnabled(mask, index);
}

function tensorData(tensor, label) {
  const data = tensor?.data;
  if (!data || !ArrayBuffer.isView(data)) throw new TypeError(`${label} has no typed-array data`);
  return data;
}

/** Fetch ordered binary chunks and concatenate them without string conversion. */
export async function fetchBinaryChunks(urls, options = {}) {
  if (!Array.isArray(urls) || !urls.length) throw new TypeError("At least one model chunk URL is required");
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("fetch is unavailable; pass options.fetchImpl");
  const maximumBytes = options.maximumBytes ?? 128 * 1024 * 1024;
  const chunks = [];
  let total = 0;
  for (const url of urls) {
    const response = await fetchImpl(url, { cache: options.cache || "force-cache" });
    if (!response?.ok) throw new Error(`Failed to load model chunk ${url}: HTTP ${response?.status ?? "unknown"}`);
    const chunk = new Uint8Array(await response.arrayBuffer());
    total += chunk.byteLength;
    if (total > maximumBytes) throw new Error(`Model chunks exceed ${maximumBytes} bytes`);
    chunks.push(chunk);
    options.onProgress?.({ loadedChunks: chunks.length, totalChunks: urls.length, loadedBytes: total });
  }
  if (options.expectedBytes != null && total !== options.expectedBytes) {
    throw new Error(`Model byte length mismatch: received ${total}, expected ${options.expectedBytes}`);
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export async function sha256Hex(bytes, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle) throw new Error("Web Crypto is unavailable for model verification");
  const digest = await cryptoImpl.subtle.digest(
    "SHA-256", bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("").toUpperCase();
}

/**
 * Letterbox RGBA ImageData into normalized RGB NCHW input.
 * The returned transform is also used to undo padding during output decode.
 */
export function preprocessImageData(imageData, inputSize = YOLO_WRINKLE_INPUT_SIZE, padValue = 114) {
  assertPositiveInteger(inputSize, "inputSize");
  const sourceWidth = Number(imageData?.width);
  const sourceHeight = Number(imageData?.height);
  assertPositiveInteger(sourceWidth, "imageData.width");
  assertPositiveInteger(sourceHeight, "imageData.height");
  const rgba = imageData?.data;
  if (!rgba || rgba.length < sourceWidth * sourceHeight * 4) {
    throw new TypeError("imageData.data must contain RGBA pixels");
  }

  const nominalScale = Math.min(inputSize / sourceWidth, inputSize / sourceHeight);
  const resizedWidth = Math.max(1, Math.min(inputSize, Math.round(sourceWidth * nominalScale)));
  const resizedHeight = Math.max(1, Math.min(inputSize, Math.round(sourceHeight * nominalScale)));
  const padX = Math.floor((inputSize - resizedWidth) / 2);
  const padY = Math.floor((inputSize - resizedHeight) / 2);
  const scaleX = resizedWidth / sourceWidth;
  const scaleY = resizedHeight / sourceHeight;
  const plane = inputSize * inputSize;
  const output = new Float32Array(plane * 3);
  output.fill(clamp(padValue, 0, 255) / 255);

  for (let y = 0; y < resizedHeight; y++) {
    const sourceY = clamp((y + 0.5) / scaleY - 0.5, 0, sourceHeight - 1);
    const y0 = Math.floor(sourceY), y1 = Math.min(sourceHeight - 1, y0 + 1);
    const ty = sourceY - y0;
    for (let x = 0; x < resizedWidth; x++) {
      const sourceX = clamp((x + 0.5) / scaleX - 0.5, 0, sourceWidth - 1);
      const x0 = Math.floor(sourceX), x1 = Math.min(sourceWidth - 1, x0 + 1);
      const tx = sourceX - x0;
      const target = (y + padY) * inputSize + x + padX;
      const i00 = (y0 * sourceWidth + x0) * 4;
      const i10 = (y0 * sourceWidth + x1) * 4;
      const i01 = (y1 * sourceWidth + x0) * 4;
      const i11 = (y1 * sourceWidth + x1) * 4;
      for (let channel = 0; channel < 3; channel++) {
        const top = rgba[i00 + channel] * (1 - tx) + rgba[i10 + channel] * tx;
        const bottom = rgba[i01 + channel] * (1 - tx) + rgba[i11 + channel] * tx;
        output[channel * plane + target] = (top * (1 - ty) + bottom * ty) / 255;
      }
    }
  }
  return {
    data: output,
    dims: [1, 3, inputSize, inputSize],
    transform: {
      inputSize, sourceWidth, sourceHeight, resizedWidth, resizedHeight,
      padX, padY, scale: nominalScale, scaleX, scaleY,
    },
  };
}

export function boxIou(first, second) {
  const x1 = Math.max(first[0], second[0]), y1 = Math.max(first[1], second[1]);
  const x2 = Math.min(first[2], second[2]), y2 = Math.min(first[3], second[3]);
  const intersection = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = Math.max(0, first[2] - first[0]) * Math.max(0, first[3] - first[1]);
  const areaB = Math.max(0, second[2] - second[0]) * Math.max(0, second[3] - second[1]);
  const union = areaA + areaB - intersection;
  return union > 0 ? intersection / union : 0;
}

/** Score-sorted, class-aware non-maximum suppression. */
export function classAwareNms(candidates, iouThreshold = 0.45, maxDetections = 100) {
  const sorted = [...(candidates || [])].sort((a, b) => b.score - a.score);
  const kept = [];
  for (const candidate of sorted) {
    const box = candidate.box || candidate.sourceBox;
    if (!box || kept.some((other) => other.classId === candidate.classId
      && boxIou(box, other.box || other.sourceBox) > iouThreshold)) continue;
    kept.push(candidate);
    if (kept.length >= maxDetections) break;
  }
  return kept;
}

function predictionLayout(dims, classCount, maskChannels) {
  if (!Array.isArray(dims) || dims.length !== 3 || dims[0] !== 1) {
    throw new Error(`Unexpected detection tensor shape: ${JSON.stringify(dims)}`);
  }
  const expectedChannels = 4 + classCount + maskChannels;
  if (dims[1] === expectedChannels) return { channels: dims[1], anchors: dims[2], channelFirst: true };
  if (dims[2] === expectedChannels) return { channels: dims[2], anchors: dims[1], channelFirst: false };
  throw new Error(`Detection tensor has no ${expectedChannels}-channel axis: ${JSON.stringify(dims)}`);
}

/** Decode [1,39,8400] YOLOv8-seg output and undo the input letterbox. */
export function decodeYoloSegOutput(prediction, transform, options = {}) {
  const classCount = options.classCount ?? YOLO_WRINKLE_CLASSES.length;
  const maskChannels = options.maskChannels ?? 32;
  const confidenceThreshold = options.confidenceThreshold ?? YOLO_WRINKLE_CONFIDENCE;
  const layout = predictionLayout(prediction?.dims, classCount, maskChannels);
  const data = tensorData(prediction, "Detection tensor");
  const at = layout.channelFirst
    ? (channel, anchor) => Number(data[channel * layout.anchors + anchor])
    : (channel, anchor) => Number(data[anchor * layout.channels + channel]);
  const inputSize = transform.inputSize;
  const candidates = [];
  for (let anchor = 0; anchor < layout.anchors; anchor++) {
    let classId = 0, score = at(4, anchor);
    for (let id = 1; id < classCount; id++) {
      const value = at(4 + id, anchor);
      if (value > score) { score = value; classId = id; }
    }
    if (!Number.isFinite(score) || score < confidenceThreshold) continue;
    const cx = at(0, anchor), cy = at(1, anchor);
    const width = Math.max(0, at(2, anchor)), height = Math.max(0, at(3, anchor));
    const modelBox = [
      clamp(cx - width / 2, 0, inputSize), clamp(cy - height / 2, 0, inputSize),
      clamp(cx + width / 2, 0, inputSize), clamp(cy + height / 2, 0, inputSize),
    ];
    const box = [
      clamp((modelBox[0] - transform.padX) / transform.scaleX, 0, transform.sourceWidth),
      clamp((modelBox[1] - transform.padY) / transform.scaleY, 0, transform.sourceHeight),
      clamp((modelBox[2] - transform.padX) / transform.scaleX, 0, transform.sourceWidth),
      clamp((modelBox[3] - transform.padY) / transform.scaleY, 0, transform.sourceHeight),
    ];
    if (!(box[2] > box[0] && box[3] > box[1])) continue;
    const coefficients = new Float32Array(maskChannels);
    for (let channel = 0; channel < maskChannels; channel++) {
      coefficients[channel] = at(4 + classCount + channel, anchor);
    }
    candidates.push({ anchor, classId, score, box, modelBox, coefficients });
  }
  const preNmsTopK = options.preNmsTopK ?? 3000;
  if (candidates.length > preNmsTopK) {
    candidates.sort((a, b) => b.score - a.score);
    candidates.length = preNmsTopK;
  }
  return candidates;
}

function sigmoid(value) {
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const exponential = Math.exp(value);
  return exponential / (1 + exponential);
}

/** Multiply one 32-value coefficient vector by the prototype tensor. */
export function decodePrototypeMask(protoData, coefficients, channels, width, height) {
  const pixels = width * height;
  if (protoData.length < channels * pixels) throw new RangeError("Prototype tensor is too small");
  if (coefficients.length < channels) throw new RangeError("Mask coefficient vector is too small");
  const output = new Float32Array(pixels);
  for (let index = 0; index < pixels; index++) {
    let logit = 0;
    for (let channel = 0; channel < channels; channel++) {
      logit += coefficients[channel] * protoData[channel * pixels + index];
    }
    output[index] = sigmoid(logit);
  }
  return output;
}

export function sampleBilinear(field, x, y, width, height) {
  x = clamp(x, 0, width - 1); y = clamp(y, 0, height - 1);
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = Math.min(width - 1, x0 + 1), y1 = Math.min(height - 1, y0 + 1);
  const tx = x - x0, ty = y - y0;
  const top = field[y0 * width + x0] * (1 - tx) + field[y0 * width + x1] * tx;
  const bottom = field[y1 * width + x0] * (1 - tx) + field[y1 * width + x1] * tx;
  return top * (1 - ty) + bottom * ty;
}

/** Rasterize retained instance masks into source-image coordinates. */
export function combinePrototypeMasks(detections, prototype, transform, options = {}) {
  const dims = prototype?.dims;
  if (!Array.isArray(dims) || dims.length !== 4 || dims[0] !== 1) {
    throw new Error(`Unexpected prototype tensor shape: ${JSON.stringify(dims)}`);
  }
  const channels = dims[1], protoHeight = dims[2], protoWidth = dims[3];
  const protoData = tensorData(prototype, "Prototype tensor");
  const width = transform.sourceWidth, height = transform.sourceHeight, pixels = width * height;
  const maskThreshold = options.maskThreshold ?? 0.5;
  const classCount = options.classCount ?? YOLO_WRINKLE_CLASSES.length;
  const binaryMask = new Uint8Array(pixels);
  const confidence = new Float32Array(pixels);
  const classMasks = Array.from({ length: classCount }, () => new Uint8Array(pixels));

  for (const detection of detections || []) {
    if (detection.classId < 0 || detection.classId >= classCount) continue;
    const instance = decodePrototypeMask(
      protoData, detection.coefficients, channels, protoWidth, protoHeight,
    );
    const x0 = clamp(Math.floor(detection.box[0]), 0, width - 1);
    const y0 = clamp(Math.floor(detection.box[1]), 0, height - 1);
    const x1 = clamp(Math.ceil(detection.box[2]), 0, width);
    const y1 = clamp(Math.ceil(detection.box[3]), 0, height);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const modelX = (x + 0.5) * transform.scaleX + transform.padX;
      const modelY = (y + 0.5) * transform.scaleY + transform.padY;
      const protoX = modelX / transform.inputSize * protoWidth - 0.5;
      const protoY = modelY / transform.inputSize * protoHeight - 0.5;
      const probability = sampleBilinear(instance, protoX, protoY, protoWidth, protoHeight);
      if (probability < maskThreshold) continue;
      const index = y * width + x;
      const value = detection.score * probability;
      binaryMask[index] = 1;
      classMasks[detection.classId][index] = 1;
      if (value > confidence[index]) confidence[index] = value;
    }
  }
  return { binaryMask, confidence, classMasks, width, height };
}

/** Restrict evidence to skin and remove eyes, brows, lips and other forbidden regions. */
export function applyAnatomicalGates(binaryMask, confidence, width, height, options = {}) {
  const pixels = width * height;
  if (binaryMask.length !== pixels || confidence.length !== pixels) throw new RangeError("Gate input shape mismatch");
  const { skinMask = null, forbiddenMask = null, regionGate = null } = options;
  if (skinMask && skinMask.length !== pixels) throw new RangeError("skinMask shape mismatch");
  if (forbiddenMask && forbiddenMask.length !== pixels) throw new RangeError("forbiddenMask shape mismatch");
  if (regionGate && regionGate.length !== pixels) throw new RangeError("regionGate shape mismatch");
  const mask = new Uint8Array(pixels), gatedConfidence = new Float32Array(pixels);
  for (let index = 0; index < pixels; index++) {
    const gate = Number(regionGate?.[index] ?? 1);
    if (!binaryMask[index] || !skinAllows(skinMask, index) || maskEnabled(forbiddenMask, index)
      || gate < Number(options.regionGateThreshold ?? 0.18)) continue;
    mask[index] = 1;
    gatedConfidence[index] = confidence[index] * Math.max(0, Math.min(1, gate));
  }
  return { mask, confidence: gatedConfidence };
}

/** Eight-connected component filtering by pixel count and geometric span. */
export function filterConnectedComponents(binary, width, height, options = {}) {
  const pixels = width * height;
  if (binary.length !== pixels) throw new RangeError("Component input shape mismatch");
  const minArea = options.minArea ?? 8;
  const minSpan = options.minSpan ?? 7;
  const visited = new Uint8Array(pixels), output = new Uint8Array(pixels);
  const queue = new Int32Array(pixels);
  for (let start = 0; start < pixels; start++) {
    if (!binary[start] || visited[start]) continue;
    let head = 0, tail = 0, minX = width, minY = height, maxX = -1, maxY = -1;
    queue[tail++] = start; visited[start] = 1;
    while (head < tail) {
      const index = queue[head++], x = index % width, y = Math.floor(index / width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        const next = yy * width + xx;
        if (!binary[next] || visited[next]) continue;
        visited[next] = 1; queue[tail++] = next;
      }
    }
    if (tail < minArea || Math.max(maxX - minX + 1, maxY - minY + 1) < minSpan) continue;
    for (let index = 0; index < tail; index++) output[queue[index]] = 1;
  }
  return output;
}

/** Zhang-Suen thinning. Input and output use 0/1 Uint8 values. */
export function skeletonizeBinary(binary, width, height, maxIterations = 96) {
  if (binary.length !== width * height) throw new RangeError("Skeleton input shape mismatch");
  const current = Uint8Array.from(binary, (value) => value ? 1 : 0);
  const remove = new Int32Array(current.length);
  const transitionCount = (p) => {
    let transitions = 0;
    for (let index = 0; index < 8; index++) if (!p[index] && p[(index + 1) % 8]) transitions++;
    return transitions;
  };
  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let removedThisIteration = 0;
    for (let pass = 0; pass < 2; pass++) {
      let count = 0;
      for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
        const index = y * width + x;
        if (!current[index]) continue;
        const p = [
          current[index - width], current[index - width + 1], current[index + 1],
          current[index + width + 1], current[index + width], current[index + width - 1],
          current[index - 1], current[index - width - 1],
        ];
        const neighbours = p.reduce((sum, value) => sum + value, 0);
        if (neighbours < 2 || neighbours > 6 || transitionCount(p) !== 1) continue;
        const keepA = pass === 0 ? p[0] * p[2] * p[4] : p[0] * p[2] * p[6];
        const keepB = pass === 0 ? p[2] * p[4] * p[6] : p[0] * p[4] * p[6];
        if (keepA || keepB) continue;
        remove[count++] = index;
      }
      for (let index = 0; index < count; index++) current[remove[index]] = 0;
      removedThisIteration += count;
    }
    if (!removedThisIteration) break;
  }
  return current;
}

/** Local PCA direction in axial q=(cos(2 theta), sin(2 theta)) form. */
export function estimateSkeletonDirections(skeleton, confidence, width, height, radius = 6) {
  const pixels = width * height;
  if (skeleton.length !== pixels || confidence.length !== pixels) throw new RangeError("Direction input shape mismatch");
  const q = new Float32Array(pixels * 2), consistency = new Float32Array(pixels);
  const outputConfidence = new Float32Array(pixels);
  const radiusSquared = radius * radius, sigmaSquared = Math.max(1, radius * radius * 0.35);
  for (let index = 0; index < pixels; index++) {
    if (!skeleton[index]) continue;
    const centerX = index % width, centerY = Math.floor(index / width);
    let sumWeight = 0, sumX = 0, sumY = 0, samples = 0;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radiusSquared) continue;
      const x = centerX + dx, y = centerY + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const next = y * width + x;
      if (!skeleton[next]) continue;
      const weight = Math.exp(-0.5 * (dx * dx + dy * dy) / sigmaSquared)
        * Math.max(0.05, confidence[next]);
      sumWeight += weight; sumX += weight * x; sumY += weight * y; samples++;
    }
    if (samples < 2 || !(sumWeight > 0)) continue;
    const meanX = sumX / sumWeight, meanY = sumY / sumWeight;
    let xx = 0, xy = 0, yy = 0;
    for (let dy = -radius; dy <= radius; dy++) for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > radiusSquared) continue;
      const x = centerX + dx, y = centerY + dy;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const next = y * width + x;
      if (!skeleton[next]) continue;
      const weight = Math.exp(-0.5 * (dx * dx + dy * dy) / sigmaSquared)
        * Math.max(0.05, confidence[next]);
      const ux = x - meanX, uy = y - meanY;
      xx += weight * ux * ux; xy += weight * ux * uy; yy += weight * uy * uy;
    }
    const trace = xx + yy;
    if (!(trace > 1e-8)) continue;
    const delta = Math.hypot(xx - yy, 2 * xy);
    const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
    q[index * 2] = Math.cos(2 * angle); q[index * 2 + 1] = Math.sin(2 * angle);
    consistency[index] = clamp(delta / trace, 0, 1);
    outputConfidence[index] = confidence[index] * consistency[index];
  }
  return { q, consistency, confidence: outputConfidence };
}

/**
 * Exact cross-expression union. Confidence and direction describe evidence
 * quality, but neither is allowed to remove a positive pixel from the union.
 */
export function consolidateParallelSkeletonUnion(results, options = {}) {
  if (!Array.isArray(results) || !results.length) return null;
  const width = options.width ?? results[0]?.width;
  const height = options.height ?? results[0]?.height;
  assertPositiveInteger(width, "width");
  assertPositiveInteger(height, "height");
  const pixels = width * height;
  const radius = Math.max(1, Math.min(8, Math.round(Number(options.radiusPx ?? 3))));
  const tolerance = Math.max(5, Math.min(45,
    Number(options.directionToleranceDegrees ?? 28)));
  const minimumDirectionDot = Math.cos(2 * tolerance * Math.PI / 180);
  const skeleton = new Uint8Array(pixels);
  const support = new Uint16Array(pixels);
  const score = new Float32Array(pixels);
  const qSum = new Float32Array(pixels * 2);
  const qWeight = new Float32Array(pixels);

  for (const result of results) {
    let source = result?.skeleton;
    if (!source || source.length !== pixels) {
      const area = result?.binaryMask || result?.mask;
      if (!area || area.length !== pixels) continue;
      source = skeletonizeBinary(area, width, height);
    }
    const confidence = result?.confidence || result?.denseConfidence;
    const direction = result?.directionQ || result?.q;
    const consistency = result?.directionConsistency || result?.consistency;
    for (let index = 0; index < pixels; index++) {
      if (!source[index]) continue;
      skeleton[index] = 1;
      support[index]++;
      const value = clamp(Number(confidence?.[index] ?? 0.5), 0, 1);
      score[index] = Math.max(score[index], value);
      const q0 = Number(direction?.[index * 2] || 0);
      const q1 = Number(direction?.[index * 2 + 1] || 0);
      const length = Math.hypot(q0, q1);
      if (!(length > 1e-6)) continue;
      const weight = Math.max(0.05, value)
        * clamp(Number(consistency?.[index] ?? 1), 0, 1);
      qSum[index * 2] += q0 / length * weight;
      qSum[index * 2 + 1] += q1 / length * weight;
      qWeight[index] += weight;
    }
  }
  if (!skeleton.some(Boolean)) return null;

  // Fill direction only where the detector did not provide one. This is used
  // solely to decide whether two nearby centerlines have the same trend.
  const estimated = estimateSkeletonDirections(skeleton, score, width, height,
    Math.max(4, radius + 2));
  const q = new Float32Array(pixels * 2);
  for (let index = 0; index < pixels; index++) {
    if (!skeleton[index]) continue;
    let q0 = qSum[index * 2], q1 = qSum[index * 2 + 1];
    let length = Math.hypot(q0, q1);
    if (!(length > 1e-6)) {
      q0 = estimated.q[index * 2];
      q1 = estimated.q[index * 2 + 1];
      length = Math.hypot(q0, q1);
    }
    if (length > 1e-6) {
      q[index * 2] = q0 / length;
      q[index * 2 + 1] = q1 / length;
    }
  }

  const kept = Uint8Array.from(skeleton);
  let removed = 0;
  for (let index = 0; index < pixels; index++) {
    if (!skeleton[index]) continue;
    const q0 = q[index * 2], q1 = q[index * 2 + 1];
    if (!(Math.hypot(q0, q1) > 1e-6)) continue;
    const angle = 0.5 * Math.atan2(q1, q0);
    const normalX = -Math.sin(angle), normalY = Math.cos(angle);
    const x = index % width, y = Math.floor(index / width);
    const rank = support[index] * 2 + score[index];
    let suppress = false;
    for (let oy = -radius; oy <= radius && !suppress; oy++) {
      for (let ox = -radius; ox <= radius; ox++) {
        if (!ox && !oy) continue;
        const distance = Math.hypot(ox, oy);
        if (distance > radius || distance < 0.75) continue;
        const normalAlignment = Math.abs(ox * normalX + oy * normalY) / distance;
        if (normalAlignment < 0.72) continue;
        const xx = x + ox, yy = y + oy;
        if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
        const candidate = yy * width + xx;
        if (!skeleton[candidate]) continue;
        const cq0 = q[candidate * 2], cq1 = q[candidate * 2 + 1];
        if (q0 * cq0 + q1 * cq1 < minimumDirectionDot) continue;
        const candidateRank = support[candidate] * 2 + score[candidate];
        if (candidateRank > rank + 1e-6
          || (Math.abs(candidateRank - rank) <= 1e-6 && candidate < index)) {
          suppress = true;
          break;
        }
      }
    }
    if (suppress) {
      kept[index] = 0;
      removed++;
    }
  }
  return { skeleton: kept, sourceSkeleton: skeleton, support, score, q, removed, radius };
}

export function fuseStrictUnion(results, options = {}) {
  if (!Array.isArray(results) || !results.length) throw new TypeError("At least one wrinkle result is required");
  const width = options.width ?? results[0]?.width;
  const height = options.height ?? results[0]?.height;
  assertPositiveInteger(width, "width");
  assertPositiveInteger(height, "height");
  const pixels = width * height;
  const binaryMask = new Uint8Array(pixels), confidence = new Float32Array(pixels);
  const support = new Uint16Array(pixels), sumQ = new Float32Array(pixels * 2);
  const directionWeight = new Float32Array(pixels);
  const classNames = [...new Set(results.flatMap((result) => Object.keys(result?.classMasks || {})))];
  const classMasks = Object.fromEntries(classNames.map((name) => [name, new Uint8Array(pixels)]));
  for (const result of results) {
    if ((result.width ?? width) !== width || (result.height ?? height) !== height) {
      throw new RangeError("Strict-union result dimensions do not match");
    }
    // Strictly union the cleaned semantic segmentation areas. V6 owns the
    // single skeletonization step after fusion; unioning per-expression
    // skeletons here discards most of the usable wrinkle evidence.
    const sourceMask = result.binaryMask || result.mask || result.skeleton;
    if (!sourceMask || sourceMask.length !== pixels) throw new RangeError("Strict-union mask shape mismatch");
    const sourceConfidence = result.denseConfidence || result.confidence;
    const sourceQ = result.directionQ || result.q;
    const sourceConsistency = result.directionConsistency || result.consistency;
    for (let index = 0; index < pixels; index++) {
      if (!sourceMask[index]) continue;
      binaryMask[index] = 1; support[index]++;
      for (const name of classNames) {
        const classMask = result.classMasks?.[name];
        if (classMask?.[index]) classMasks[name][index] = 1;
      }
      const value = Number(sourceConfidence?.[index] || 0);
      if (value > confidence[index]) confidence[index] = value;
      const q0 = Number(sourceQ?.[index * 2] || 0), q1 = Number(sourceQ?.[index * 2 + 1] || 0);
      const qLength = Math.hypot(q0, q1);
      if (!(qLength > 1e-6)) continue;
      const weight = Math.max(1e-6, value) * clamp(Number(sourceConsistency?.[index] ?? 1), 0, 1);
      sumQ[index * 2] += q0 / qLength * weight;
      sumQ[index * 2 + 1] += q1 / qLength * weight;
      directionWeight[index] += weight;
    }
  }
  const directionQ = new Float32Array(pixels * 2), directionConsistency = new Float32Array(pixels);
  const repeatability = new Float32Array(pixels), mask = new Uint8Array(pixels);
  for (let index = 0; index < pixels; index++) {
    if (!binaryMask[index]) continue;
    mask[index] = 255;
    repeatability[index] = support[index] / results.length;
    const q0 = sumQ[index * 2], q1 = sumQ[index * 2 + 1], magnitude = Math.hypot(q0, q1);
    if (!(magnitude > 1e-8)) continue;
    directionQ[index * 2] = q0 / magnitude;
    directionQ[index * 2 + 1] = q1 / magnitude;
    directionConsistency[index] = clamp(magnitude / Math.max(1e-8, directionWeight[index]), 0, 1);
  }
  let consolidatedSkeleton = null, consolidatedMask = null, consolidation = null;
  if (Number(options.consolidationRadiusPx) > 0) {
    consolidation = consolidateParallelSkeletonUnion(results, {
      width,
      height,
      radiusPx: options.consolidationRadiusPx,
      directionToleranceDegrees: options.consolidationDirectionToleranceDegrees,
    });
    consolidatedSkeleton = consolidation?.skeleton || null;
    if (consolidatedSkeleton) {
      consolidatedMask = new Uint8Array(pixels);
      // Keep a thin semantic band around the selected centerline, but never
      // invent evidence outside the exact pixelwise union.
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const index = y * width + x;
        if (!binaryMask[index]) continue;
        let near = false;
        for (let oy = -1; oy <= 1 && !near; oy++) for (let ox = -1; ox <= 1; ox++) {
          const xx = x + ox, yy = y + oy;
          if (xx >= 0 && yy >= 0 && xx < width && yy < height
            && consolidatedSkeleton[yy * width + xx]) { near = true; break; }
        }
        if (near) consolidatedMask[index] = 255;
      }
    }
  }
  return {
    width, height, mask, skeleton: binaryMask, binaryMask,
    confidence, directionQ, directionConsistency, support, repeatability,
    classMasks,
    consolidatedMask, consolidatedSkeleton,
    consolidationDiagnostics: consolidation ? {
      radiusPx: consolidation.radius,
      sourceSkeletonPixels: consolidation.sourceSkeleton.reduce((sum, value) => sum + value, 0),
      consolidatedSkeletonPixels: consolidation.skeleton.reduce((sum, value) => sum + value, 0),
      removedParallelPixels: consolidation.removed,
    } : null,
    expressionCount: results.length, fusionOperation: "strict_union",
  };
}

function findOutputTensors(outputs) {
  const tensors = Object.values(outputs || {});
  const prediction = tensors.find((tensor) => Array.isArray(tensor?.dims) && tensor.dims.length === 3
    && (tensor.dims[1] === 39 || tensor.dims[2] === 39));
  const prototype = tensors.find((tensor) => Array.isArray(tensor?.dims) && tensor.dims.length === 4
    && tensor.dims[1] === 32);
  if (!prediction || !prototype) {
    throw new Error(`Expected outputs [1,39,8400] and [1,32,160,160], received ${tensors
      .map((tensor) => JSON.stringify(tensor?.dims)).join(", ")}`);
  }
  return { prediction, prototype };
}

export class YoloWrinkleOnnx {
  constructor(options = {}) {
    this.chunkUrls = options.chunkUrls || DEFAULT_MODEL_CHUNK_URLS;
    this.inputSize = options.inputSize ?? YOLO_WRINKLE_INPUT_SIZE;
    this.confidenceThreshold = options.confidenceThreshold ?? YOLO_WRINKLE_CONFIDENCE;
    this.iouThreshold = options.iouThreshold ?? 0.45;
    this.maxDetections = options.maxDetections ?? 100;
    this.maskThreshold = options.maskThreshold ?? 0.5;
    this.executionProviders = options.executionProviders || ["wasm"];
    this.wasmPaths = options.wasmPaths;
    // 生产默认校验内容哈希，而不是只比总字节数：分片拼接错位或资产被替换时
    // 必须直接失败。仅测试可显式传 false 跳过。
    this.verifySha256 = options.verifySha256 !== false;
    this.fetchImpl = options.fetchImpl;
    this.runtime = options.runtime || null;
    this.session = options.session || null;
    this.modelBytes = null;
  }

  async load(onProgress) {
    if (this.session) return this;
    const runtime = this.runtime || await import("onnxruntime-web/wasm");
    if (this.wasmPaths && runtime.env?.wasm) runtime.env.wasm.wasmPaths = this.wasmPaths;
    const bytes = await fetchBinaryChunks(this.chunkUrls, {
      fetchImpl: this.fetchImpl,
      expectedBytes: YOLO_WRINKLE_MODEL_BYTES,
      onProgress,
    });
    if (this.verifySha256) {
      const actual = await sha256Hex(bytes);
      if (actual !== YOLO_WRINKLE_MODEL_SHA256) throw new Error(`Model SHA-256 mismatch: ${actual}`);
    }
    this.runtime = runtime;
    this.session = await runtime.InferenceSession.create(bytes, {
      executionProviders: this.executionProviders,
      graphOptimizationLevel: "all",
    });
    // InferenceSession owns the compiled model; do not retain another 47 MB
    // copy in browser memory after initialization.
    this.modelBytes = null;
    return this;
  }

  async infer(imageData, options = {}) {
    await this.load(options.onModelProgress);
    const prepared = preprocessImageData(imageData, this.inputSize);
    const inputName = this.session.inputNames?.[0] || "images";
    const tensor = new this.runtime.Tensor("float32", prepared.data, prepared.dims);
    let outputs;
    try {
      outputs = await this.session.run({ [inputName]: tensor });
      const { prediction, prototype } = findOutputTensors(outputs);
      const decoded = decodeYoloSegOutput(prediction, prepared.transform, {
        confidenceThreshold: options.confidenceThreshold ?? this.confidenceThreshold,
        preNmsTopK: options.preNmsTopK,
      });
      const detections = classAwareNms(
        decoded, options.iouThreshold ?? this.iouThreshold,
        options.maxDetections ?? this.maxDetections,
      );
      const combined = combinePrototypeMasks(detections, prototype, prepared.transform, {
        maskThreshold: options.maskThreshold ?? this.maskThreshold,
      });
      const gated = applyAnatomicalGates(
        combined.binaryMask, combined.confidence, combined.width, combined.height,
        {
          skinMask: options.skinMask,
          forbiddenMask: options.forbiddenMask,
          regionGate: options.regionGate,
          regionGateThreshold: options.regionGateThreshold,
        },
      );
      const components = filterConnectedComponents(gated.mask, combined.width, combined.height, {
        minArea: options.minComponentArea ?? 8,
        minSpan: options.minComponentSpan ?? 7,
      });
      let skeleton = skeletonizeBinary(
        components, combined.width, combined.height, options.maxSkeletonIterations ?? 96,
      );
      skeleton = filterConnectedComponents(skeleton, combined.width, combined.height, {
        minArea: options.minSkeletonPixels ?? 7,
        minSpan: options.minSkeletonSpan ?? 7,
      });
      const directions = estimateSkeletonDirections(
        skeleton, gated.confidence, combined.width, combined.height,
        options.directionRadius ?? 6,
      );
      const mask = Uint8Array.from(skeleton, (value) => value ? 255 : 0);
      const classMasks = Object.fromEntries(YOLO_WRINKLE_CLASSES.map((name, classId) => {
        const current = combined.classMasks[classId];
      const gatedClass = new Uint8Array(current.length);
      for (let index = 0; index < current.length; index++) {
        if (current[index] && skinAllows(options.skinMask, index)
            && !maskEnabled(options.forbiddenMask, index)
            && Number(options.regionGate?.[index] ?? 1) >= Number(options.regionGateThreshold ?? 0.18)) {
          gatedClass[index] = 1;
        }
        }
        return [name, gatedClass];
      }));
      return {
        version: YOLO_WRINKLE_ONNX_VERSION,
        width: combined.width,
        height: combined.height,
        mask,
        skeleton,
        binaryMask: components,
        confidence: directions.confidence,
        denseConfidence: gated.confidence,
        directionQ: directions.q,
        directionConsistency: directions.consistency,
        classMasks,
        detections: detections.map((detection) => ({
          classId: detection.classId,
          className: YOLO_WRINKLE_CLASSES[detection.classId],
          score: detection.score,
          box: [...detection.box],
        })),
        transform: prepared.transform,
        diagnostics: {
          candidateCount: decoded.length,
          detectionCount: detections.length,
          componentPixels: components.reduce((sum, value) => sum + value, 0),
          skeletonPixels: skeleton.reduce((sum, value) => sum + value, 0),
          confidenceThreshold: options.confidenceThreshold ?? this.confidenceThreshold,
          iouThreshold: options.iouThreshold ?? this.iouThreshold,
          maskThreshold: options.maskThreshold ?? this.maskThreshold,
        },
      };
    } finally {
      tensor.dispose?.();
      for (const output of Object.values(outputs || {})) output?.dispose?.();
    }
  }

  async detect(imageData, options = {}) {
    return this.infer(imageData, options);
  }

  async close() {
    await this.session?.release?.();
    this.session = null;
    this.modelBytes = null;
  }
}

export const WrinkleYoloOnnx = YoloWrinkleOnnx;
