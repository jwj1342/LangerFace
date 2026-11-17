import type { TumorInput } from "./incisionCandidateTools.ts";

type DynamicRecord = Record<string, any>;

export const INCISION_WORKSPACE_SESSION_KEY = "langerface:incision-workspace-session:v1";
export const INCISION_WORKSPACE_SESSION_SCHEMA = "incision-workspace-session/v1";

export interface IncisionWorkspaceSession {
  schema_version: typeof INCISION_WORKSPACE_SESSION_SCHEMA;
  tumor: TumorInput;
  result: DynamicRecord | null;
  baseResult: DynamicRecord | null;
  saved: DynamicRecord[];
  review: DynamicRecord;
  generationCount: number;
  updated_at: string;
}

interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function browserSessionStorage(): SessionStorageLike | null {
  try {
    return globalThis.sessionStorage || null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is DynamicRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function buildIncisionWorkspaceSession({
  tumor,
  result,
  baseResult,
  saved,
  review,
  generationCount,
  updatedAt = new Date().toISOString(),
}: {
  tumor: TumorInput;
  result: DynamicRecord | null;
  baseResult: DynamicRecord | null;
  saved: DynamicRecord[];
  review: DynamicRecord;
  generationCount: number;
  updatedAt?: string;
}): IncisionWorkspaceSession {
  return {
    schema_version: INCISION_WORKSPACE_SESSION_SCHEMA,
    tumor,
    result,
    baseResult,
    saved,
    review,
    generationCount: Math.max(0, Math.trunc(Number(generationCount) || 0)),
    updated_at: updatedAt,
  };
}

export function tumorContextsMatch(left: unknown, right: unknown): boolean {
  if (!isRecord(left) || !isRecord(right)) return false;
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch {
    return false;
  }
}

export function saveIncisionWorkspaceSession(
  session: IncisionWorkspaceSession,
  storage: SessionStorageLike | null = browserSessionStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(INCISION_WORKSPACE_SESSION_KEY, JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}

export function loadIncisionWorkspaceSession(
  storage: SessionStorageLike | null = browserSessionStorage(),
): IncisionWorkspaceSession | null {
  if (!storage) return null;
  try {
    const payload = JSON.parse(storage.getItem(INCISION_WORKSPACE_SESSION_KEY) || "null");
    if (
      !isRecord(payload)
      || payload.schema_version !== INCISION_WORKSPACE_SESSION_SCHEMA
      || !isRecord(payload.tumor)
      || !Array.isArray(payload.tumor.center)
      || payload.tumor.center.length !== 3
      || !Array.isArray(payload.saved)
      || !isRecord(payload.review)
      || (payload.result !== null && !isRecord(payload.result))
      || (payload.baseResult !== null && !isRecord(payload.baseResult))
    ) return null;
    return payload as IncisionWorkspaceSession;
  } catch {
    return null;
  }
}
