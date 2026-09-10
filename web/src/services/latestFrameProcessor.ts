export interface LatestFrameProcessorOptions<Frame, Result> {
  process: (frame: Frame) => Promise<Result>;
  commit: (result: Result, frame: Frame) => void;
  timestamp: (frame: Frame) => number;
  onError?: (error: unknown, frame: Frame) => void;
}

export interface LatestFrameProcessorDiagnostics {
  submitted: number;
  started: number;
  committed: number;
  droppedBeforeStart: number;
  supersededInFlight: number;
  errors: number;
  active: boolean;
  pending: boolean;
  lastCommittedTimestamp: number | null;
}

export class LatestFrameProcessor<Frame, Result> {
  private readonly processFrame: (frame: Frame) => Promise<Result>;
  private readonly commitResult: (result: Result, frame: Frame) => void;
  private readonly frameTimestamp: (frame: Frame) => number;
  private readonly onError?: (error: unknown, frame: Frame) => void;
  private pendingFrame: Frame | null = null;
  private active = false;
  private generation = 0;
  private lastCommittedTimestamp: number | null = null;
  private idleResolvers: Array<() => void> = [];
  private counters = {
    submitted: 0,
    started: 0,
    committed: 0,
    droppedBeforeStart: 0,
    supersededInFlight: 0,
    errors: 0,
  };

  constructor(options: LatestFrameProcessorOptions<Frame, Result>) {
    this.processFrame = options.process;
    this.commitResult = options.commit;
    this.frameTimestamp = options.timestamp;
    this.onError = options.onError;
  }

  submit(frame: Frame): void {
    this.counters.submitted += 1;
    if (this.pendingFrame !== null) this.counters.droppedBeforeStart += 1;
    this.pendingFrame = frame;
    void this.drain(this.generation);
  }

  cancel(): void {
    this.generation += 1;
    if (this.pendingFrame !== null) this.counters.droppedBeforeStart += 1;
    this.pendingFrame = null;
    this.lastCommittedTimestamp = null;
    if (!this.active) this.resolveIdle();
  }

  waitForIdle(): Promise<void> {
    if (!this.active && this.pendingFrame === null) return Promise.resolve();
    return new Promise(resolve => this.idleResolvers.push(resolve));
  }

  diagnostics(): LatestFrameProcessorDiagnostics {
    return {
      ...this.counters,
      active: this.active,
      pending: this.pendingFrame !== null,
      lastCommittedTimestamp: this.lastCommittedTimestamp,
    };
  }

  private async drain(generation: number): Promise<void> {
    if (this.active || generation !== this.generation) return;
    this.active = true;
    try {
      while (this.pendingFrame !== null && generation === this.generation) {
        const frame = this.pendingFrame;
        this.pendingFrame = null;
        this.counters.started += 1;
        try {
          const result = await this.processFrame(frame);
          if (generation !== this.generation) continue;
          if (this.pendingFrame !== null) {
            this.counters.supersededInFlight += 1;
            continue;
          }
          const timestamp = this.frameTimestamp(frame);
          if (this.lastCommittedTimestamp !== null && timestamp < this.lastCommittedTimestamp) {
            this.counters.supersededInFlight += 1;
            continue;
          }
          this.commitResult(result, frame);
          this.lastCommittedTimestamp = timestamp;
          this.counters.committed += 1;
        } catch (error) {
          if (generation !== this.generation) continue;
          if (this.pendingFrame !== null) {
            this.counters.supersededInFlight += 1;
            continue;
          }
          this.counters.errors += 1;
          this.onError?.(error, frame);
        }
      }
    } finally {
      this.active = false;
      if (this.pendingFrame !== null) void this.drain(this.generation);
      else this.resolveIdle();
    }
  }

  private resolveIdle(): void {
    for (const resolve of this.idleResolvers.splice(0)) resolve();
  }
}
