import type { Vec3 } from "./softBody.ts";

export interface BenchmarkLine { id: string; points: number[][] }
export interface BenchmarkSample {
  wallTime: number;
  mediaTime: number;
  stages: Record<string, number>;
  presentedFrames?: number;
  presentedMediaTime?: number;
  expectedDisplayTime?: number;
  handCount?: number;
  handDetectorRan?: boolean;
  wrinkles?: BenchmarkLine[];
  rstl?: BenchmarkLine[];
}
export interface LiveBenchmark {
  recording: boolean;
  scheduler?: "animation" | "video";
  handInput?: "video" | "canvas";
  presented?: { presentedFrames: number; mediaTime: number; expectedDisplayTime: number };
  samples: BenchmarkSample[];
  current?: BenchmarkSample;
  seed?: BenchmarkLine[];
  seedRstl?: BenchmarkLine[];
}

export function liveBenchmark(): LiveBenchmark | undefined {
  return (globalThis as typeof globalThis & { __liveBenchmark?: LiveBenchmark }).__liveBenchmark;
}

export function sampleBenchmarkLines(lines: readonly { name: string; pts: Vec3[] }[]): BenchmarkLine[] {
  return lines.filter((_, i) => i % 10 === 0).map((line) => ({
    id: line.name,
    points: line.pts.filter((_, i) => i % 8 === 0).map((point) => [point[0], point[1]]),
  }));
}
