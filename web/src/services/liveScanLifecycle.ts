import { LiveFrameScheduler, type FrameCancel, type FrameRequest } from "./liveFrameScheduler.ts";

export interface LiveScanStream {
  getTracks(): Array<{ stop(): void }>;
}

export interface LiveScanLifecycleOptions {
  requestFrame?: FrameRequest;
  cancelFrame?: FrameCancel;
  releaseStream?: (stream: LiveScanStream) => void;
}

export class LiveScanLifecycle {
  private readonly frameScheduler: LiveFrameScheduler;
  private readonly releaseStream: (stream: LiveScanStream) => void;
  private nextToken = 0;
  private activeToken: number | null = null;
  private stream: LiveScanStream | null = null;

  constructor({ requestFrame, cancelFrame, releaseStream }: LiveScanLifecycleOptions = {}) {
    this.frameScheduler = new LiveFrameScheduler({ requestFrame, cancelFrame });
    this.releaseStream = releaseStream ?? ((stream) => {
      for (const track of stream.getTracks()) track.stop();
    });
  }

  begin(): number {
    this.stop();
    this.activeToken = ++this.nextToken;
    return this.activeToken;
  }

  isActive(token: number): boolean {
    return this.activeToken === token;
  }

  adoptStream(token: number, stream: LiveScanStream): boolean {
    if (!this.isActive(token)) {
      this.releaseStream(stream);
      return false;
    }
    this.releaseOwnedStream();
    this.stream = stream;
    return true;
  }

  schedule(token: number, callback: (timeMs: number) => void): boolean {
    if (!this.isActive(token)) return false;
    return this.frameScheduler.request((timeMs) => {
      if (this.isActive(token)) callback(timeMs);
    });
  }

  stop(): void {
    this.activeToken = null;
    this.frameScheduler.cancel();
    this.releaseOwnedStream();
  }

  private releaseOwnedStream(): void {
    const stream = this.stream;
    this.stream = null;
    if (stream) this.releaseStream(stream);
  }
}
