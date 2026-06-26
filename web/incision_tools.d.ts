export interface TumorInput {
  kind?: string;
  center?: [number, number, number];
  diameter_mm?: number;
  depth_mm?: number | null;
  margin_mm?: number;
  boundary?: Array<[number, number, number]>;
  boundary_mode?: string;
  boundary_source?: string;
  source?: string;
  author?: string;
  units?: string;
}

export interface IncisionCandidateEdit {
  angle_offset_deg?: number;
  length_scale?: number;
  width_scale?: number;
  shift_along_mm?: number;
  shift_perp_mm?: number;
  reason?: string;
  session_history?: unknown[];
  [key: string]: unknown;
}

export interface AgentTraceGateResult {
  passed: boolean;
  observed_actions?: string[];
  missing_actions: Array<{ key?: string; label: string; actions?: string[] }>;
}

export function normalizeTumorInput(tumor: TumorInput): TumorInput & {
  kind: "subcutaneous" | "cutaneous";
  center: [number, number, number];
  diameter_mm: number;
  depth_mm: number | null;
  margin_mm: number;
  boundary: Array<[number, number, number]>;
  boundary_mode: string;
  boundary_source: string;
  source: string;
  author: string;
  units: string;
};

export function summarizeTumorInputQuality(tumor: TumorInput): {
  passed: boolean;
  warning_count: number;
  warnings: Array<{ code: string; severity: string; message?: string }>;
  source?: string;
  boundary_source?: string;
  author_present?: boolean;
  units?: string;
};

export function summarizeTumorBoundary(
  tumor: TumorInput,
  axis?: ArrayLike<number>,
  normal?: ArrayLike<number>,
  unitsPerMm?: number,
): Record<string, any>;

export function unitsPerMmFromVertices(
  verts: Array<[number, number, number]>,
  faceHeightMm?: number,
): number;

export function classifyRegion(
  point: [number, number, number],
  verts: Array<[number, number, number]>,
): Record<string, any>;

export function agentTraceGate(result: Record<string, any> | null | undefined): AgentTraceGateResult;

export function applyCandidateEdit(
  result: Record<string, any>,
  edit: IncisionCandidateEdit,
  normal: [number, number, number],
  unitsPerMm: number,
  verts: Array<[number, number, number]>,
): Record<string, any>;

export function compareCandidateRecords(records: Array<Record<string, any>>): Array<Record<string, any>>;

export function planIncisionWorkflow(request: {
  tumor: TumorInput;
  verts: Array<[number, number, number]>;
  tris: Array<[number, number, number]>;
  atlas: unknown;
  normal?: [number, number, number];
  angleOffsetsDeg?: number[];
  rules?: unknown;
}): Record<string, unknown>;
