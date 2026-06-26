export interface AtlasProvenanceMeta {
  source?: string;
  validated?: boolean;
  count?: number;
}

export interface IncisionOverlayQaState {
  tone?: "ok" | "warn" | "pending";
  label?: string;
  detail?: string;
}

export function setIncisionOverlayQa(state?: IncisionOverlayQaState | null): void;
export function setMsg(message: string | null): void;
export function setProvenance(meta: AtlasProvenanceMeta | null): void;
export function smoothLabel(value: number): string;
