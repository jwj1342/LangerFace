export interface LiveActionSchedulerOptions<TSession> {
  currentSession: () => TSession;
  isActive: (session: TSession) => boolean;
  publish: (reason: string) => void;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === "object" && value !== null) || typeof value === "function"
  ) && "then" in value && typeof value.then === "function";
}

export class LiveActionScheduler<TSession> {
  private readonly options: LiveActionSchedulerOptions<TSession>;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: LiveActionSchedulerOptions<TSession>) {
    this.options = options;
  }

  schedule(reason = "state_update", session = this.options.currentSession()): void {
    if (!this.options.isActive(session)) return;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.options.isActive(session)) this.options.publish(reason);
    }, 0);
  }

  run<TResult>(reason: string, action: () => TResult): TResult {
    const session = this.options.currentSession();
    try {
      const result = action();
      this.schedule(reason, session);
      if (isPromiseLike(result)) {
        result.then(
          () => this.schedule(`${reason}_done`, session),
          () => this.schedule(`${reason}_failed`, session),
        );
      }
      return result;
    } catch (error) {
      this.schedule(`${reason}_failed`, session);
      throw error;
    }
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
