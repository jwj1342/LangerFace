import type { Mat } from "@techstark/opencv-js";
import type { WrinkleTextureFrame, WrinkleTextureLine } from "./liveWrinkleTextureTracking.ts";

type OpenCv = typeof import("@techstark/opencv-js");
let runtime: Promise<OpenCv> | null = null;

interface ControlLine {
  id: string;
  className: string;
  indices: number[];
  start: number;
}

export interface OpticalFlowDiagnostics {
  mode: "seed" | "temporal" | "reference" | "suspended";
  controlCount: number;
  acceptedCount: number;
  recoveredCount: number;
  meanMeshCorrectionPx: number;
  durationMs: number;
}

const MAX_CONTROLS = 32;
const MAX_FB_ERROR = 1;
const MAX_PATCH_ERROR = 22;

/** Sparse skin-patch tracking; no segmentation or wrinkle extraction occurs here. */
export class WrinkleOpticalFlowTracker {
  private reference: Mat | null = null;
  private previous: Mat | null = null;
  private spareGray: Mat | null = null;
  private matchBuffers: Mat[] = [];
  private referencePoints: Float32Array = new Float32Array();
  private previousPoints: Float32Array = new Float32Array();
  private previousMesh: Float32Array = new Float32Array();
  private valid: Uint8Array = new Uint8Array();
  private lines: ControlLine[] = [];
  private mediaTime = Number.NaN;
  private frames = 0;
  private sourceWidth = 0;
  private sourceHeight = 0;
  private stats: OpticalFlowDiagnostics = {
    mode: "suspended", controlCount: 0, acceptedCount: 0,
    recoveredCount: 0, meanMeshCorrectionPx: 0, durationMs: 0,
  };

  private cv: OpenCv;

  constructor(cv: OpenCv) { this.cv = cv; }

  static async create(): Promise<WrinkleOpticalFlowTracker> {
    runtime ||= import("./liveWrinkleOpenCv.ts").then((module) => module.loadOpenCv())
      .catch((error) => { runtime = null; throw error; });
    return new WrinkleOpticalFlowTracker(await runtime);
  }

  diagnostics(): OpticalFlowDiagnostics { return { ...this.stats }; }

  hasFrame(time: number): boolean { return time === this.mediaTime; }

  suspend(): void {
    this.previous?.delete();
    this.previous = null;
    this.mediaTime = Number.NaN;
    this.stats = { ...this.stats, mode: "suspended", acceptedCount: 0 };
  }

  dispose(): void {
    this.suspend();
    this.spareGray?.delete();
    this.spareGray = null;
    for (const mat of this.matchBuffers) mat.delete();
    this.matchBuffers = [];
    this.reference?.delete();
    this.reference = null;
    this.lines = [];
    this.referencePoints = new Float32Array();
    this.previousPoints = new Float32Array();
    this.previousMesh = new Float32Array();
    this.valid = new Uint8Array();
  }

  private gray(frame: WrinkleTextureFrame): Mat {
    const result = new this.cv.Mat(frame.height, frame.width, this.cv.CV_8UC1);
    result.data.set(frame.gray);
    return result;
  }

  private copy(mat: Mat): Mat {
    // Embind clone() can share the native object; flow input/output must not alias.
    const result = new this.cv.Mat();
    mat.copyTo(result);
    return result;
  }

  seed(frame: WrinkleTextureFrame, lines: readonly WrinkleTextureLine[], time: number): void {
    this.dispose();
    this.reference = this.gray(frame);
    this.previous = this.copy(this.reference);
    this.sourceWidth = frame.sourceWidth;
    this.sourceHeight = frame.sourceHeight;
    let start = 0;
    this.lines = lines.map((line) => {
      const count = Math.min(MAX_CONTROLS, line.points.length);
      const indices = Array.from({ length: count }, (_, index) => (
        count === 1 ? 0 : Math.round(index * (line.points.length - 1) / (count - 1))
      ));
      const control = { id: line.id, className: line.className, indices, start };
      start += count;
      return control;
    });
    this.referencePoints = this.meshPoints(frame, lines);
    this.previousPoints = this.referencePoints.slice();
    this.previousMesh = this.referencePoints.slice();
    this.valid = new Uint8Array(start).fill(1);
    this.mediaTime = time;
    this.frames = 0;
    this.stats = {
      mode: "seed", controlCount: start, acceptedCount: start,
      recoveredCount: 0, meanMeshCorrectionPx: 0, durationMs: 0,
    };
  }

  private meshPoints(frame: WrinkleTextureFrame, lines: readonly WrinkleTextureLine[]): Float32Array {
    const points = new Float32Array(this.lines.reduce((count, line) => count + line.indices.length * 2, 0));
    let offset = 0;
    this.lines.forEach((line, lineIndex) => {
      for (const index of line.indices) {
        points[offset++] = lines[lineIndex].points[index][0] * frame.width / frame.sourceWidth;
        points[offset++] = lines[lineIndex].points[index][1] * frame.height / frame.sourceHeight;
      }
    });
    return points;
  }

  private match(from: Mat, to: Mat, points: Float32Array, guess: Float32Array) {
    const cv = this.cv;
    const count = points.length / 2;
    if (!this.matchBuffers.length) {
      this.matchBuffers = Array.from({ length: 7 }, () => new cv.Mat());
    }
    const [before, after, back, status, reverseStatus, error, reverseError] = this.matchBuffers;
    before.create(count, 1, cv.CV_32FC2);
    after.create(count, 1, cv.CV_32FC2);
    back.create(count, 1, cv.CV_32FC2);
    before.data32F.set(points);
    after.data32F.set(guess);
    back.data32F.set(points);
    try {
      const window = new cv.Size(21, 21);
      const criteria = new cv.TermCriteria(cv.TermCriteria_COUNT | cv.TermCriteria_EPS, 30, 0.01);
      const levels = Math.min(3, Math.max(0, Math.floor(Math.log2(Math.min(from.cols, from.rows) / 64))));
      cv.calcOpticalFlowPyrLK(from, to, before, after, status, error,
        window, levels, criteria, cv.OPTFLOW_USE_INITIAL_FLOW, 0.0001);
      cv.calcOpticalFlowPyrLK(to, from, after, back, reverseStatus, reverseError,
        window, levels, criteria, cv.OPTFLOW_USE_INITIAL_FLOW, 0.0001);
      const tracked = after.data32F.slice();
      const valid = new Uint8Array(count);
      for (let i = 0; i < count; i += 1) {
        const x = tracked[i * 2];
        const y = tracked[i * 2 + 1];
        valid[i] = Number(Boolean(status.data[i] && reverseStatus.data[i])
          && error.data32F[i] < MAX_PATCH_ERROR
          && x >= 4 && y >= 4 && x < to.cols - 4 && y < to.rows - 4
          && Math.hypot(back.data32F[i * 2] - points[i * 2],
            back.data32F[i * 2 + 1] - points[i * 2 + 1]) <= MAX_FB_ERROR);
      }
      return { points: tracked, valid };
    } catch (error) {
      for (const mat of this.matchBuffers) mat.delete();
      this.matchBuffers = [];
      throw error;
    }
  }

  update(frame: WrinkleTextureFrame, mesh: readonly WrinkleTextureLine[], time: number): WrinkleTextureLine[] {
    if (!this.reference || frame.width !== this.reference.cols || frame.height !== this.reference.rows
        || frame.sourceWidth !== this.sourceWidth || frame.sourceHeight !== this.sourceHeight
        || mesh.length !== this.lines.length || !this.referencePoints.length) return [];
    const start = performance.now();
    const currentMesh = this.meshPoints(frame, mesh);
    if (this.hasFrame(time)) return this.render(frame, mesh, currentMesh);
    const current = this.spareGray || new this.cv.Mat();
    this.spareGray = null;
    current.create(frame.height, frame.width, this.cv.CV_8UC1);
    current.data.set(frame.gray);
    try {
      const referenceMode = !this.previous || !Number.isFinite(this.mediaTime)
        || time <= this.mediaTime || time - this.mediaTime > 0.25;
      const from = referenceMode ? this.reference : this.previous!;
      const points = referenceMode ? this.referencePoints : this.previousPoints;
      const guess = referenceMode ? currentMesh : currentMesh.map((value, index) => (
        this.valid[Math.floor(index / 2)]
          ? this.previousPoints[index] + value - this.previousMesh[index]
          : value
      ));
      const match = this.match(from, current, points, guess);
      let recovered = 0;
      if (!referenceMode) {
        for (let i = 0; i < match.valid.length; i += 1) match.valid[i] &= this.valid[i];
        // Recover only existing reference patches, never create new wrinkle evidence.
        if (++this.frames % 12 === 0 && match.valid.some((value) => !value)) {
          const recovery = this.match(this.reference, current, this.referencePoints, currentMesh);
          for (let i = 0; i < match.valid.length; i += 1) {
            if (!match.valid[i] && recovery.valid[i]) {
              match.valid[i] = 1;
              match.points[i * 2] = recovery.points[i * 2];
              match.points[i * 2 + 1] = recovery.points[i * 2 + 1];
              recovered += 1;
            }
          }
        }
      }
      for (let i = 0; i < match.valid.length; i += 1) {
        if (Math.hypot(match.points[i * 2] - currentMesh[i * 2],
          match.points[i * 2 + 1] - currentMesh[i * 2 + 1]) > Math.max(12, frame.width * 0.04)) {
          match.valid[i] = 0;
        }
      }
      if (!referenceMode) {
        for (let i = 0; i < match.valid.length; i += 1) {
          if (!match.valid[i]) continue;
          const offset = i * 2;
          const residual = Math.hypot(
            match.points[offset] - guess[offset],
            match.points[offset + 1] - guess[offset + 1],
          );
          // Small LK residuals are mostly sampling jitter; larger coherent skin
          // motion should remain responsive during expressions.
          const response = Math.max(0, Math.min(1, residual / 3));
          const alpha = 0.70 + 0.24 * response;
          match.points[offset] = guess[offset]
            + (match.points[offset] - guess[offset]) * alpha;
          match.points[offset + 1] = guess[offset + 1]
            + (match.points[offset + 1] - guess[offset + 1]) * alpha;
        }
      }
      this.previousPoints = match.points;
      this.previousMesh = currentMesh;
      this.valid = match.valid;
      // Rotate independent image buffers: preserve the current pixels for the
      // next frame without a full-image copy or aliasing the fixed reference.
      this.spareGray = this.previous;
      this.previous = current;
      this.mediaTime = time;
      let correction = 0;
      let accepted = 0;
      for (let i = 0; i < this.valid.length; i += 1) {
        if (!this.valid[i]) continue;
        accepted += 1;
        correction += Math.hypot(
          (match.points[i * 2] - currentMesh[i * 2]) * frame.sourceWidth / frame.width,
          (match.points[i * 2 + 1] - currentMesh[i * 2 + 1]) * frame.sourceHeight / frame.height,
        );
      }
      this.stats = {
        mode: referenceMode ? "reference" : "temporal", controlCount: this.valid.length,
        acceptedCount: accepted, recoveredCount: recovered,
        meanMeshCorrectionPx: accepted ? correction / accepted : 0,
        durationMs: performance.now() - start,
      };
      return this.render(frame, mesh, currentMesh);
    } finally {
      if (this.previous !== current) this.spareGray = current;
    }
  }

  private render(frame: WrinkleTextureFrame, mesh: readonly WrinkleTextureLine[], currentMesh: Float32Array) {
    const output: WrinkleTextureLine[] = [];
    this.lines.forEach((line, lineIndex) => {
      let run: Array<[number, number]> = [];
      let runStart = 0;
      let right = 1;
      const flush = () => {
        if (run.length >= 2) output.push({
          id: `${line.id}:skin:${runStart}`, className: line.className, points: run,
        });
        run = [];
      };
      mesh[lineIndex].points.forEach(([x, y], index) => {
        if (line.indices.length < 2) return;
        while (right < line.indices.length - 1 && index > line.indices[right]) right += 1;
        const left = right - 1;
        const a = line.start + left;
        const b = line.start + right;
        // Do not bridge lost skin patches with plausible-looking mesh-only lines.
        if (!this.valid[a] || !this.valid[b]) { flush(); return; }
        const weight = (index - line.indices[left]) / (line.indices[right] - line.indices[left]);
        const dx = (1 - weight) * (this.previousPoints[a * 2] - currentMesh[a * 2])
          + weight * (this.previousPoints[b * 2] - currentMesh[b * 2]);
        const dy = (1 - weight) * (this.previousPoints[a * 2 + 1] - currentMesh[a * 2 + 1])
          + weight * (this.previousPoints[b * 2 + 1] - currentMesh[b * 2 + 1]);
        if (!run.length) runStart = index;
        run.push([x + dx * frame.sourceWidth / frame.width, y + dy * frame.sourceHeight / frame.height]);
      });
      flush();
    });
    return output;
  }
}
