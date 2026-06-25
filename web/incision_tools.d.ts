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

export function summarizeTumorInputQuality(tumor: TumorInput): {
  passed: boolean;
  warning_count: number;
  warnings: Array<{ code: string; severity: string; message?: string }>;
  source?: string;
  boundary_source?: string;
  author_present?: boolean;
  units?: string;
};
