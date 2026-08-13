export type FrameRequest = (callback: (timeMs: number) => void) => number;
export type FrameCancel = (frameId: number) => void;

interface PendingFrame {
  id: number | null;
  generation: number;
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

  request(callback: (timeMs: number) => void): boolean {
    if (this.pending) return false;
    const pending: PendingFrame = { id: null, generation: this.generation };
    this.pending = pending;
    pending.id = this.requestFrame((timeMs) => {
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
    if (pending?.id != null) this.cancelFrame(pending.id);
  }

  hasPending(): boolean {
    return this.pending !== null;
  }
}
