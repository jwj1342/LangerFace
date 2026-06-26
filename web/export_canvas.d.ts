export interface RecordingExtraCanvas {
  label?: string;
  canvas: HTMLCanvasElement;
}

export interface CanvasRecordingController {
  readonly recording: boolean;
  readonly chunkCount: number;
  start(): boolean;
  stop(): boolean;
  toggle(): boolean;
}

export function createCanvasRecordingController(options?: {
  canvas?: HTMLCanvasElement;
  getExtraCanvases?: () => RecordingExtraCanvas[];
  system?: string | (() => string);
  fps?: number;
  onStateChange?: (recording: boolean) => void;
}): CanvasRecordingController;
