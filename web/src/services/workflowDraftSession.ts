import type { IncisionEdit } from "./incisionEditHistory";
import type { IncisionWorkspaceSession } from "./incisionWorkspaceSession";

type DynamicRecord = Record<string, any>;

export const WORKFLOW_DRAFT_SESSION_KEY = "langerface:workflow-draft:v1";
export const WORKFLOW_DRAFT_SCHEMA = "workflow-draft/v1";
export const WORKFLOW_DRAFT_TTL_MS = 30 * 60 * 1000;
export const WORKFLOW_DRAFT_CHANGED_EVENT = "langerface:workflow-draft-changed";
export const WORKFLOW_DRAFT_RESTORE_EVENT = "langerface:workflow-draft-restore";

export interface WorkflowDraftPhoto {
  dataUrl: string;
  fileName: string;
  mimeType: "image/jpeg";
  width: number;
  height: number;
}

export interface WorkflowIncisionDraft {
  workspace: IncisionWorkspaceSession;
  edit: IncisionEdit;
  boundaryMode: "ellipse" | "freehand";
  ellipseRatio: number;
  controlledBoundary: boolean;
  controlledBoundaryPhotoDiameterMm: number | null;
}

export interface WorkflowDraftSession {
  schema_version: typeof WORKFLOW_DRAFT_SCHEMA;
  saved_at: string;
  expires_at: string;
  photo: WorkflowDraftPhoto;
  incision: WorkflowIncisionDraft | null;
}

interface SessionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
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

function validPhoto(value: unknown): value is WorkflowDraftPhoto {
  return isRecord(value)
    && typeof value.dataUrl === "string"
    && value.dataUrl.startsWith("data:image/jpeg;base64,")
    && typeof value.fileName === "string"
    && value.mimeType === "image/jpeg"
    && Number(value.width) > 0
    && Number(value.height) > 0;
}

function validIncision(value: unknown): value is WorkflowIncisionDraft | null {
  if (value === null) return true;
  if (!isRecord(value) || !isRecord(value.workspace) || !isRecord(value.edit)) return false;
  const workspace = value.workspace;
  return workspace.schema_version === "incision-workspace-session/v1"
    && isRecord(workspace.tumor)
    && Array.isArray(workspace.tumor.center)
    && workspace.tumor.center.length === 3
    && Array.isArray(workspace.saved)
    && isRecord(workspace.review)
    && (value.boundaryMode === "ellipse" || value.boundaryMode === "freehand")
    && Number.isFinite(Number(value.ellipseRatio));
}

function dispatchDraftChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(WORKFLOW_DRAFT_CHANGED_EVENT));
}

function writeDraft(
  draft: WorkflowDraftSession,
  storage: SessionStorageLike | null = browserSessionStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(WORKFLOW_DRAFT_SESSION_KEY, JSON.stringify(draft));
    dispatchDraftChanged();
    return true;
  } catch {
    return false;
  }
}

export function loadWorkflowDraftSession(
  storage: SessionStorageLike | null = browserSessionStorage(),
  now = Date.now(),
): WorkflowDraftSession | null {
  if (!storage) return null;
  try {
    const payload = JSON.parse(storage.getItem(WORKFLOW_DRAFT_SESSION_KEY) || "null");
    if (
      !isRecord(payload)
      || payload.schema_version !== WORKFLOW_DRAFT_SCHEMA
      || !validPhoto(payload.photo)
      || !validIncision(payload.incision)
      || !Number.isFinite(Date.parse(String(payload.saved_at)))
      || !Number.isFinite(Date.parse(String(payload.expires_at)))
    ) return null;
    if (Date.parse(payload.expires_at) <= now) {
      storage.removeItem(WORKFLOW_DRAFT_SESSION_KEY);
      return null;
    }
    return payload as WorkflowDraftSession;
  } catch {
    return null;
  }
}

export function clearWorkflowDraftSession(
  storage: SessionStorageLike | null = browserSessionStorage(),
): void {
  if (!storage) return;
  try {
    storage.removeItem(WORKFLOW_DRAFT_SESSION_KEY);
    dispatchDraftChanged();
  } catch {
    // Locked-down and private browser contexts may reject session storage.
  }
}

export function saveWorkflowDraftPhoto(
  photo: WorkflowDraftPhoto,
  storage: SessionStorageLike | null = browserSessionStorage(),
  now = Date.now(),
): boolean {
  const savedAt = new Date(now).toISOString();
  return writeDraft({
    schema_version: WORKFLOW_DRAFT_SCHEMA,
    saved_at: savedAt,
    expires_at: new Date(now + WORKFLOW_DRAFT_TTL_MS).toISOString(),
    photo,
    incision: null,
  }, storage);
}

export function saveWorkflowIncisionDraft(
  incision: WorkflowIncisionDraft | null,
  storage: SessionStorageLike | null = browserSessionStorage(),
  now = Date.now(),
): boolean {
  const current = loadWorkflowDraftSession(storage, now);
  if (!current) return false;
  const savedAt = new Date(now).toISOString();
  return writeDraft({
    ...current,
    saved_at: savedAt,
    expires_at: new Date(now + WORKFLOW_DRAFT_TTL_MS).toISOString(),
    incision,
  }, storage);
}

export function buildWorkflowDraftPhoto(
  file: Pick<File, "name">,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
): WorkflowDraftPhoto | null {
  if (typeof document === "undefined") return null;
  try {
    const maxSide = 1280;
    const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
    const width = Math.max(1, Math.round(sourceWidth * scale));
    const height = Math.max(1, Math.round(sourceHeight * scale));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(source, 0, 0, width, height);
    return {
      dataUrl: canvas.toDataURL("image/jpeg", 0.78),
      fileName: file.name || "workflow-photo.jpg",
      mimeType: "image/jpeg",
      width,
      height,
    };
  } catch {
    return null;
  }
}

export async function workflowDraftPhotoFile(photo: WorkflowDraftPhoto): Promise<File> {
  const blob = await fetch(photo.dataUrl).then((response) => response.blob());
  return new File([blob], photo.fileName || "workflow-photo.jpg", {
    type: photo.mimeType,
    lastModified: Date.now(),
  });
}

export function requestWorkflowDraftRestore(incision: WorkflowIncisionDraft | null): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(WORKFLOW_DRAFT_RESTORE_EVENT, { detail: incision }));
}
