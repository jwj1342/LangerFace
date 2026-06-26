import {
  ANNOTATE_DRAW_REACT_COMMAND_EVENT,
  ANNOTATE_LIBRARY_REACT_COMMAND_EVENT,
  ANNOTATE_MESH_REACT_COMMAND_EVENT,
  INCISION_EDIT_REACT_COMMAND_EVENT,
  INCISION_LIBRARY_REACT_COMMAND_EVENT,
  INCISION_PROVIDER_REACT_STATE_EVENT,
  INCISION_REVIEW_REACT_COMMAND_EVENT,
  INCISION_SECONDARY_CUE_REACT_COMMAND_EVENT,
  INCISION_TUMOR_REACT_COMMAND_EVENT,
  LIVE_RENDER_REACT_COMMAND_EVENT,
  LIVE_ROUTE_REACT_COMMAND_EVENT,
  LIVE_SOURCE_REACT_COMMAND_EVENT,
} from "./controllerEvents";

export interface ControllerCommandDetail<TCommand extends string = string> {
  command: TCommand;
  [key: string]: unknown;
}

export type LiveSourceCommand = "upload_source" | "camera_toggle" | "pause_toggle" | "recording_toggle";
export type LiveRenderCommand =
  | "template_change"
  | "density_input"
  | "opacity_input"
  | "mirror_toggle"
  | "mesh_points_toggle"
  | "restore_atlas";
export type LiveRouteCommand =
  | "route_change"
  | "load_demo_recon"
  | "start_scan"
  | "view_3d"
  | "project_3d"
  | "reset_3d"
  | "start_twin"
  | "toggle_twin_head"
  | "toggle_twin_texture";

export type AnnotateMeshCommand =
  | "load_canonical"
  | "load_flame"
  | "load_fitted_flame"
  | "cloud_fit_flame";
export type AnnotateDrawCommand = "system_changed" | "start_line" | "undo_last" | "save_current_line";
export type AnnotateLibraryCommand =
  | "clear_lines"
  | "restore_line"
  | "delete_line"
  | "export_atlas"
  | "export_xyz"
  | "set_active_atlas";

export type IncisionTumorCommand =
  | "kind_changed"
  | "diameter_input"
  | "diameter_changed"
  | "author_changed"
  | "depth_input"
  | "depth_changed"
  | "margin_input"
  | "margin_changed"
  | "boundary_mode_changed"
  | "ellipse_ratio_input"
  | "ellipse_ratio_changed"
  | "toggle_boundary"
  | "clear_boundary"
  | "export_tumor"
  | "import_tumor"
  | "run_agent";
export type IncisionSecondaryCueCommand =
  | "import_secondary_cue"
  | "clear_secondary_cue"
  | "secondary_cue_confirmed";
export type IncisionEditCommand =
  | "preview_edit"
  | "commit_edit"
  | "commit_reason"
  | "undo_edit"
  | "redo_edit"
  | "reset_edit";
export type IncisionReviewCommand =
  | "review_state_changed"
  | "approve_candidate"
  | "reject_candidate"
  | "save_review";
export type IncisionLibraryCommand =
  | "save_current"
  | "make_variants"
  | "clear_saved"
  | "export_json"
  | "export_report"
  | "export_png"
  | "stage_live_overlay"
  | "load_candidate"
  | "remove_candidate";

export function dispatchControllerEvent<TDetail>(eventName: string, detail: TDetail) {
  window.dispatchEvent(new CustomEvent<TDetail>(eventName, { detail }));
}

export function dispatchControllerCommand<TDetail extends ControllerCommandDetail>(
  eventName: string,
  detail: TDetail,
) {
  dispatchControllerEvent(eventName, detail);
}

export function dispatchLiveSourceCommand(command: LiveSourceCommand) {
  dispatchControllerCommand(LIVE_SOURCE_REACT_COMMAND_EVENT, { command });
}

export function dispatchLiveRenderCommand(command: LiveRenderCommand, value?: string | number | boolean) {
  dispatchControllerCommand(LIVE_RENDER_REACT_COMMAND_EVENT, { command, value });
}

export function dispatchLiveRouteCommand(command: LiveRouteCommand, value?: string | boolean) {
  dispatchControllerCommand(LIVE_ROUTE_REACT_COMMAND_EVENT, { command, value });
}

export function dispatchAnnotateMeshCommand(command: AnnotateMeshCommand) {
  dispatchControllerCommand(ANNOTATE_MESH_REACT_COMMAND_EVENT, { command });
}

export function dispatchAnnotateDrawCommand(command: AnnotateDrawCommand, value?: string) {
  dispatchControllerCommand(ANNOTATE_DRAW_REACT_COMMAND_EVENT, { command, value });
}

export function dispatchAnnotateLibraryCommand(command: AnnotateLibraryCommand, index?: number) {
  dispatchControllerCommand(ANNOTATE_LIBRARY_REACT_COMMAND_EVENT, { command, index });
}

export function dispatchIncisionTumorCommand(command: IncisionTumorCommand) {
  dispatchControllerCommand(INCISION_TUMOR_REACT_COMMAND_EVENT, { command });
}

export function dispatchIncisionProviderState(source = "react_provider_panel") {
  dispatchControllerEvent(INCISION_PROVIDER_REACT_STATE_EVENT, { source });
}

export function dispatchIncisionSecondaryCueCommand(command: IncisionSecondaryCueCommand) {
  dispatchControllerCommand(INCISION_SECONDARY_CUE_REACT_COMMAND_EVENT, { command });
}

export function dispatchIncisionEditCommand(command: IncisionEditCommand) {
  dispatchControllerCommand(INCISION_EDIT_REACT_COMMAND_EVENT, { command });
}

export function dispatchIncisionReviewCommand(command: IncisionReviewCommand) {
  dispatchControllerCommand(INCISION_REVIEW_REACT_COMMAND_EVENT, { command });
}

export function dispatchIncisionLibraryCommand(command: IncisionLibraryCommand, id?: string) {
  dispatchControllerCommand(INCISION_LIBRARY_REACT_COMMAND_EVENT, { command, id });
}
