export type FrameRequest = (callback: (timeMs: number) => void) => number;
export type FrameCancel = (frameId: number) => void;

interface PendingFrame {
  id: number | null;
  generation: number;
  cancel: FrameCancel;
}

export interface VideoFrameSource {
  paused: boolean;
  ended: boolean;
  requestVideoFrameCallback?: (callback: (now: number, metadata: VideoFrameCallbackMetadata) => void) => number;
  cancelVideoFrameCallback?: FrameCancel;
}

export interface LiveFrameSchedulerOptions {
  requestFrame?: FrameRequest;
  cancelFrame?: FrameCancel;
}

export class LiveFrameScheduler {
  private readonly requestFrame: FrameRequest;
  private readonly cancelFrame: FrameCancel;
  private pending: PendingFrame | null = null;
  private generation = 0;

  constructor({
    requestFrame = (callback) => globalThis.requestAnimationFrame(callback),
    cancelFrame = (frameId) => globalThis.cancelAnimationFrame(frameId),
  }: LiveFrameSchedulerOptions = {}) {
    this.requestFrame = requestFrame;
    this.cancelFrame = cancelFrame;
  }

  request(callback: (timeMs: number) => void, video?: VideoFrameSource | null): boolean {
    if (this.pending) return false;
    const useVideo = video && !video.paused && !video.ended
      && video.requestVideoFrameCallback && video.cancelVideoFrameCallback;
    const request = useVideo
      ? (cb: (now: number) => void) => video.requestVideoFrameCallback!(cb)
      : this.requestFrame;
    const cancel = useVideo
      ? (id: number) => video.cancelVideoFrameCallback!(id)
      : this.cancelFrame;
    const pending: PendingFrame = { id: null, generation: this.generation, cancel };
    this.pending = pending;
    pending.id = request((timeMs) => {
      if (this.pending !== pending || pending.generation !== this.generation) return;
      this.pending = null;
      callback(timeMs);
    });
    return true;
  }

  cancel(): void {
    this.generation += 1;
    const pending = this.pending;
    this.pending = null;
    if (pending?.id != null) pending.cancel(pending.id);
  }

  hasPending(): boolean {
    return this.pending !== null;
  }
}
