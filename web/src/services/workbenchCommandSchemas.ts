import {
  ANNOTATE_DRAW_COMMANDS,
  ANNOTATE_LIBRARY_COMMANDS,
  ANNOTATE_MESH_COMMANDS,
  LIVE_RENDER_COMMANDS,
  LIVE_ROUTE_COMMANDS,
  LIVE_SOURCE_COMMANDS,
  readControllerCommandDetail,
  type AnnotateDrawCommand,
  type AnnotateLibraryCommand,
  type AnnotateMeshCommand,
  type ControllerCommandDetail,
  type LiveRenderCommand,
  type LiveRouteCommand,
  type LiveSourceCommand,
} from "../lib/controllerCommand.ts";

type CommandEvent = Event | { detail?: unknown } | null | undefined;

export interface LiveRenderCommandDetail
  extends ControllerCommandDetail<LiveRenderCommand> {
  value?: string | number | boolean;
}

export interface LiveRouteCommandDetail
  extends ControllerCommandDetail<LiveRouteCommand> {
  value?: string | boolean;
}

export interface AnnotateDrawCommandDetail
  extends ControllerCommandDetail<AnnotateDrawCommand> {
  value?: string;
}

export interface AnnotateLibraryCommandDetail
  extends ControllerCommandDetail<AnnotateLibraryCommand> {
  index?: number;
}

function eventDetail(event: CommandEvent): { detail?: unknown } {
  return event as { detail?: unknown };
}

function numberInRange(value: unknown, min: number, max: number): boolean {
  return (
    (typeof value === "number" || typeof value === "string")
    && value !== ""
    && Number.isFinite(Number(value))
    && Number(value) >= min
    && Number(value) <= max
  );
}

export function readLiveSourceCommand(
  event: CommandEvent,
): ControllerCommandDetail<LiveSourceCommand> | null {
  return readControllerCommandDetail(eventDetail(event), LIVE_SOURCE_COMMANDS);
}

export function readLiveRenderCommand(
  event: CommandEvent,
): LiveRenderCommandDetail | null {
  const detail = readControllerCommandDetail(eventDetail(event), LIVE_RENDER_COMMANDS);
  if (!detail) return null;
  if (detail.command === "template_change") {
    return detail.value === "rstl" || detail.value === "langer"
      ? detail as LiveRenderCommandDetail
      : null;
  }
  if (detail.command === "density_input" || detail.command === "opacity_input") {
    return numberInRange(detail.value, 0, 100)
      ? detail as LiveRenderCommandDetail
      : null;
  }
  if (detail.command === "mirror_toggle" || detail.command === "mesh_points_toggle") {
    return typeof detail.value === "boolean"
      ? detail as LiveRenderCommandDetail
      : null;
  }
  return detail;
}

export function readLiveRouteCommand(
  event: CommandEvent,
): LiveRouteCommandDetail | null {
  const detail = readControllerCommandDetail(eventDetail(event), LIVE_ROUTE_COMMANDS);
  if (!detail) return null;
  if (detail.command === "route_change") {
    return detail.value === "2d" || detail.value === "3d"
      ? detail as LiveRouteCommandDetail
      : null;
  }
  return detail;
}

export function readAnnotateMeshCommand(
  event: CommandEvent,
): ControllerCommandDetail<AnnotateMeshCommand> | null {
  return readControllerCommandDetail(eventDetail(event), ANNOTATE_MESH_COMMANDS);
}

export function readAnnotateDrawCommand(
  event: CommandEvent,
): AnnotateDrawCommandDetail | null {
  const detail = readControllerCommandDetail(eventDetail(event), ANNOTATE_DRAW_COMMANDS);
  if (!detail) return null;
  if (detail.command === "system_changed") {
    return detail.value === "rstl" || detail.value === "langer"
      ? detail as AnnotateDrawCommandDetail
      : null;
  }
  return detail;
}

export function readAnnotateLibraryCommand(
  event: CommandEvent,
): AnnotateLibraryCommandDetail | null {
  const detail = readControllerCommandDetail(eventDetail(event), ANNOTATE_LIBRARY_COMMANDS);
  if (!detail) return null;
  if (detail.command === "restore_line" || detail.command === "delete_line") {
    return Number.isInteger(detail.index) && Number(detail.index) >= 0
      ? detail as AnnotateLibraryCommandDetail
      : null;
  }
  return detail;
}
