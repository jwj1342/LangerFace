import { createCanvasRecordingController, type CanvasRecordingController, type RecordingExtraCanvas } from "./canvasRecording.ts";

interface LiveRecordingActionsOptions {
  canvas: () => HTMLCanvasElement;
  getExtraCanvases: () => RecordingExtraCanvas[];
  system: () => string;
  onStateChange: (recording: boolean, controller: CanvasRecordingController) => void;
  setMsg: (message: string) => void;
  setTransientMsg: (message: string) => void;
  logError: (event: string, error: unknown) => void;
}

export function createLiveRecordingActions(options: LiveRecordingActionsOptions,
  createController = createCanvasRecordingController) {
  let recordingController: CanvasRecordingController | null = null;
  function ensureController(): CanvasRecordingController {
    if (!recordingController) {
      recordingController = createController({
        canvas: options.canvas(),
        getExtraCanvases: options.getExtraCanvases,
        system: options.system,
        onStateChange(recording) {
          options.onStateChange(recording, recordingController!);
        },
        onError(error) {
          const detail = error instanceof Error ? error.message : "未知错误";
          options.setMsg(`视频导出失败：${detail}`);
          options.logError("video_export_failed", error);
        },
        onDownloadRequested(filename) {
          options.setTransientMsg(`已向浏览器提交下载：${filename}。通常保存在“文件管理 → 下载（Download）”；是否完成请以浏览器下载记录为准。`);
        },
      });
    }
    return recordingController;
  }
  return {
    toggleRecording() { ensureController().toggle(); },
    async exportCurrentImage(): Promise<void> {
      const controller = ensureController();
      try { await controller.exportImage(); }
      catch (error) {
        const detail = error instanceof Error ? error.message : "未知错误";
        options.setMsg(`图片导出失败：${detail}`);
        options.logError("image_export_failed", error);
      }
    },
    stop() { recordingController?.stop(); },
    reset() { recordingController = null; },
  };
}
