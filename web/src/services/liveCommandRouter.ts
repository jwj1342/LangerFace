import type {
  LiveRenderCommand,
  LiveRouteCommand,
  LiveSourceCommand,
} from "../lib/controllerCommand.ts";
import {
  readLiveRenderCommand,
  readLiveRouteCommand,
  readLiveSourceCommand,
} from "./workbenchCommandSchemas.ts";

type LiveCommandEvent = Event | { detail?: unknown } | null | undefined;
type LiveRoute = "2d" | "3d";
type LiveTemplate = "rstl" | "langer";

export interface LiveCommandActions {
  run(reason: string, action: () => unknown): unknown;
  uploadSource(): unknown;
  cameraToggle(): unknown;
  pauseToggle(): unknown;
  recordingToggle(): unknown;
  templateChange(value: LiveTemplate): unknown;
  densityInput(value: number): unknown;
  opacityInput(value: number): unknown;
  mirrorToggle(value: boolean): unknown;
  meshPointsToggle(value: boolean): unknown;
  restoreAtlas(): unknown;
  clearIncisionOverlay(): unknown;
  routeChange(value: LiveRoute): unknown;
  loadDemoRecon(): unknown;
  startScan(): unknown;
  view3d(): unknown;
  project3d(): unknown;
  reset3d(): unknown;
  startTwin(): unknown;
  toggleTwinHead(): unknown;
  toggleTwinTexture(): unknown;
}

function percentage(value: unknown): number | null {
  if ((typeof value !== "number" && typeof value !== "string") || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 && parsed <= 100
    ? parsed
    : null;
}

export class LiveCommandRouter {
  private readonly actions: LiveCommandActions;

  constructor(actions: LiveCommandActions) {
    this.actions = actions;
  }

  private execute(reason: string, action: () => unknown): true {
    this.actions.run(reason, action);
    return true;
  }

  source(command: LiveSourceCommand): true {
    switch (command) {
      case "upload_source":
        return this.execute(command, () => this.actions.uploadSource());
      case "camera_toggle":
        return this.execute(command, () => this.actions.cameraToggle());
      case "pause_toggle":
        return this.execute(command, () => this.actions.pauseToggle());
      case "recording_toggle":
        return this.execute(command, () => this.actions.recordingToggle());
    }
  }

  render(command: LiveRenderCommand, value?: unknown): boolean {
    switch (command) {
      case "template_change":
        if (value !== "rstl" && value !== "langer") return false;
        return this.execute(command, () => this.actions.templateChange(value));
      case "density_input": {
        const parsed = percentage(value);
        return parsed === null ? false : this.execute(command, () => this.actions.densityInput(parsed));
      }
      case "opacity_input": {
        const parsed = percentage(value);
        return parsed === null ? false : this.execute(command, () => this.actions.opacityInput(parsed));
      }
      case "mirror_toggle":
        return typeof value === "boolean"
          ? this.execute(command, () => this.actions.mirrorToggle(value))
          : false;
      case "mesh_points_toggle":
        return typeof value === "boolean"
          ? this.execute(command, () => this.actions.meshPointsToggle(value))
          : false;
      case "restore_atlas":
        return this.execute(command, () => this.actions.restoreAtlas());
      case "clear_incision_overlay":
        return this.execute(command, () => this.actions.clearIncisionOverlay());
    }
  }

  route(command: LiveRouteCommand, value?: unknown): boolean {
    switch (command) {
      case "route_change":
        if (value !== "2d" && value !== "3d") return false;
        return this.execute(command, () => this.actions.routeChange(value));
      case "load_demo_recon":
        return this.execute(command, () => this.actions.loadDemoRecon());
      case "start_scan":
        return this.execute(command, () => this.actions.startScan());
      case "view_3d":
        return this.execute(command, () => this.actions.view3d());
      case "project_3d":
        return this.execute(command, () => this.actions.project3d());
      case "reset_3d":
        return this.execute(command, () => this.actions.reset3d());
      case "start_twin":
        return this.execute(command, () => this.actions.startTwin());
      case "toggle_twin_head":
        return this.execute(command, () => this.actions.toggleTwinHead());
      case "toggle_twin_texture":
        return this.execute(command, () => this.actions.toggleTwinTexture());
    }
  }

  handleSourceEvent(event: LiveCommandEvent): boolean {
    const detail = readLiveSourceCommand(event);
    return detail ? this.source(detail.command) : false;
  }

  handleRenderEvent(event: LiveCommandEvent): boolean {
    const detail = readLiveRenderCommand(event);
    return detail ? this.render(detail.command, detail.value) : false;
  }

  handleRouteEvent(event: LiveCommandEvent): boolean {
    const detail = readLiveRouteCommand(event);
    return detail ? this.route(detail.command, detail.value) : false;
  }
}
