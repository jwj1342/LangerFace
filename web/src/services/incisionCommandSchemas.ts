import {
  INCISION_EDIT_COMMANDS,
  INCISION_LIBRARY_COMMANDS,
  INCISION_REVIEW_COMMANDS,
  INCISION_SECONDARY_CUE_COMMANDS,
  INCISION_TUMOR_COMMANDS,
  readControllerCommandDetail,
  type ControllerCommandDetail,
  type IncisionEditCommand,
  type IncisionLibraryCommand,
  type IncisionReviewCommand,
  type IncisionSecondaryCueCommand,
  type IncisionTumorCommand,
} from "../lib/controllerCommand.ts";

type CommandEvent = Event | { detail?: unknown } | null | undefined;

export interface IncisionTumorCommandDetail
  extends ControllerCommandDetail<IncisionTumorCommand> {
  value?: string | number;
}

export interface IncisionLibraryCommandDetail
  extends ControllerCommandDetail<IncisionLibraryCommand> {
  id?: string;
}

const NUMERIC_TUMOR_COMMANDS = new Set<IncisionTumorCommand>([
  "diameter_input",
  "diameter_changed",
  "depth_input",
  "depth_changed",
  "margin_input",
  "margin_changed",
  "ellipse_ratio_input",
  "ellipse_ratio_changed",
]);

function eventDetail(event: CommandEvent): { detail?: unknown } {
  return event as { detail?: unknown };
}

function hasFiniteNumericValue(
  detail: ControllerCommandDetail<IncisionTumorCommand>,
): detail is IncisionTumorCommandDetail & { value: string | number } {
  return (
    (typeof detail.value === "string" || typeof detail.value === "number")
    && detail.value !== ""
    && Number.isFinite(Number(detail.value))
  );
}

export function readIncisionTumorCommand(
  event: CommandEvent,
): IncisionTumorCommandDetail | null {
  const detail = readControllerCommandDetail(eventDetail(event), INCISION_TUMOR_COMMANDS);
  if (!detail) return null;
  if (NUMERIC_TUMOR_COMMANDS.has(detail.command)) {
    return hasFiniteNumericValue(detail) ? detail : null;
  }
  if (detail.command === "kind_changed") {
    return detail.value === "subcutaneous" || detail.value === "cutaneous"
      ? detail as IncisionTumorCommandDetail
      : null;
  }
  if (detail.command === "boundary_mode_changed") {
    return detail.value === "ellipse" || detail.value === "freehand"
      ? detail as IncisionTumorCommandDetail
      : null;
  }
  if (detail.command === "author_changed") {
    return typeof detail.value === "string"
      ? detail as IncisionTumorCommandDetail
      : null;
  }
  return detail;
}

export function readIncisionSecondaryCueCommand(
  event: CommandEvent,
): ControllerCommandDetail<IncisionSecondaryCueCommand> | null {
  return readControllerCommandDetail(eventDetail(event), INCISION_SECONDARY_CUE_COMMANDS);
}

export function readIncisionEditCommand(
  event: CommandEvent,
): ControllerCommandDetail<IncisionEditCommand> | null {
  return readControllerCommandDetail(eventDetail(event), INCISION_EDIT_COMMANDS);
}

export function readIncisionReviewCommand(
  event: CommandEvent,
): ControllerCommandDetail<IncisionReviewCommand> | null {
  return readControllerCommandDetail(eventDetail(event), INCISION_REVIEW_COMMANDS);
}

export function readIncisionLibraryCommand(
  event: CommandEvent,
): IncisionLibraryCommandDetail | null {
  const detail = readControllerCommandDetail(eventDetail(event), INCISION_LIBRARY_COMMANDS);
  if (!detail) return null;
  if (detail.command === "load_candidate" || detail.command === "remove_candidate") {
    return typeof detail.id === "string" && detail.id.trim()
      ? detail as IncisionLibraryCommandDetail
      : null;
  }
  return detail;
}
