import type {
  IncisionEditCommand,
  IncisionEditControlId,
  IncisionLibraryCommand,
  IncisionReviewCommand,
  IncisionSecondaryCueCommand,
  IncisionTumorCommand,
} from "../lib/controllerCommand.ts";
import {
  readIncisionEditCommand,
  readIncisionLibraryCommand,
  readIncisionReviewCommand,
  readIncisionSecondaryCueCommand,
  readIncisionTumorCommand,
} from "./incisionCommandSchemas.ts";

type IncisionCommandEvent = Event | { detail?: unknown } | null | undefined;

export interface IncisionCommandActions {
  applyTumorControl(command: IncisionTumorCommand, value?: string | number): unknown;
  resetBoundaryForTumorKind(): unknown;
  setBoundaryInactive(): unknown;
  updateFormVisibility(kind?: "subcutaneous" | "cutaneous"): unknown;
  publish(reason: string): unknown;
  previewWorkflow(): unknown;
  updateTumorRing(): unknown;
  toggleBoundaryDrawing(): unknown;
  clearBoundaryPoints(): unknown;
  exportTumor(): unknown;
  importTumor(): unknown;
  runWorkflow(): unknown;
  importSecondaryCue(): unknown;
  clearSecondaryCue(): unknown;
  confirmSecondaryCue(): unknown;
  applyEditControl(controlId?: IncisionEditControlId, value?: string): unknown;
  applyEditControls(): unknown;
  commitEdit(interaction: "control_change" | "reason_change"): unknown;
  undoEdit(): unknown;
  redoEdit(): unknown;
  resetEdit(): unknown;
  updateReviewState(): unknown;
  saveReview(): unknown;
  saveCurrentCandidate(): unknown;
  makeVariants(): unknown;
  clearSaved(): unknown;
  loadCandidate(id: string): unknown;
  removeCandidate(id: string): unknown;
  exportJson(): unknown;
  exportReport(): unknown;
  exportPng(): unknown;
  stageLiveOverlay(): unknown;
}

export class IncisionCommandRouter {
  private readonly actions: IncisionCommandActions;

  constructor(actions: IncisionCommandActions) {
    this.actions = actions;
  }

  handleTumorEvent(event: IncisionCommandEvent): boolean {
    const detail = readIncisionTumorCommand(event);
    if (!detail) return false;
    const { command, value } = detail;
    this.actions.applyTumorControl(command, value);
    switch (command) {
      case "kind_changed":
        this.actions.resetBoundaryForTumorKind();
        this.actions.updateFormVisibility(value as "subcutaneous" | "cutaneous");
        this.actions.publish("tumor_kind_changed");
        this.actions.previewWorkflow();
        return true;
      case "diameter_input":
        this.actions.updateTumorRing();
        this.actions.publish("tumor_diameter_input");
        return true;
      case "diameter_inactive_hint":
        this.actions.publish(command);
        return true;
      case "depth_input":
      case "author_changed":
        this.actions.publish(command);
        return true;
      case "margin_input":
      case "ellipse_ratio_input":
        this.actions.updateTumorRing();
        this.actions.publish(command);
        return true;
      case "diameter_changed":
      case "depth_changed":
      case "margin_changed":
      case "ellipse_ratio_changed":
        this.actions.previewWorkflow();
        return true;
      case "boundary_mode_changed":
        this.actions.setBoundaryInactive();
        this.actions.updateFormVisibility();
        this.actions.publish("tumor_boundary_mode_changed");
        this.actions.previewWorkflow();
        return true;
      case "toggle_boundary":
        this.actions.toggleBoundaryDrawing();
        return true;
      case "clear_boundary":
        this.actions.clearBoundaryPoints();
        return true;
      case "export_tumor":
        this.actions.exportTumor();
        return true;
      case "import_tumor":
        this.actions.importTumor();
        return true;
      case "run_workflow":
        this.actions.runWorkflow();
        return true;
    }
  }

  handleSecondaryCueEvent(event: IncisionCommandEvent): boolean {
    const detail = readIncisionSecondaryCueCommand(event);
    if (!detail) return false;
    const command: IncisionSecondaryCueCommand = detail.command;
    switch (command) {
      case "import_secondary_cue":
        this.actions.importSecondaryCue();
        return true;
      case "clear_secondary_cue":
        this.actions.clearSecondaryCue();
        return true;
      case "secondary_cue_confirmed":
        this.actions.confirmSecondaryCue();
        return true;
    }
  }

  handleEditEvent(event: IncisionCommandEvent): boolean {
    const detail = readIncisionEditCommand(event);
    if (!detail) return false;
    const command: IncisionEditCommand = detail.command;
    if (detail.controlId !== undefined) {
      this.actions.applyEditControl(detail.controlId, detail.value);
    }
    switch (command) {
      case "preview_edit":
        this.actions.applyEditControls();
        return true;
      case "commit_edit":
        this.actions.commitEdit("control_change");
        return true;
      case "commit_reason":
        this.actions.applyEditControls();
        this.actions.commitEdit("reason_change");
        return true;
      case "undo_edit":
        this.actions.undoEdit();
        return true;
      case "redo_edit":
        this.actions.redoEdit();
        return true;
      case "reset_edit":
        this.actions.resetEdit();
        return true;
    }
  }

  handleReviewEvent(event: IncisionCommandEvent): boolean {
    const detail = readIncisionReviewCommand(event);
    if (!detail) return false;
    const command: IncisionReviewCommand = detail.command;
    switch (command) {
      case "review_state_changed":
        this.actions.updateReviewState();
        return true;
      case "save_review":
        this.actions.saveReview();
        return true;
    }
  }

  handleLibraryEvent(event: IncisionCommandEvent): boolean {
    const detail = readIncisionLibraryCommand(event);
    if (!detail) return false;
    const command: IncisionLibraryCommand = detail.command;
    switch (command) {
      case "save_current":
        this.actions.saveCurrentCandidate();
        return true;
      case "make_variants":
        this.actions.makeVariants();
        return true;
      case "clear_saved":
        this.actions.clearSaved();
        return true;
      case "load_candidate":
        this.actions.loadCandidate(detail.id as string);
        return true;
      case "remove_candidate":
        this.actions.removeCandidate(detail.id as string);
        return true;
      case "export_json":
        this.actions.exportJson();
        return true;
      case "export_report":
        this.actions.exportReport();
        return true;
      case "export_png":
        this.actions.exportPng();
        return true;
      case "stage_live_overlay":
        this.actions.stageLiveOverlay();
        return true;
    }
  }
}
