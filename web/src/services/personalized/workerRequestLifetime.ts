/** Settle callers even when terminating a Worker drops its RPC responses. */
export function createWorkerRequestLifetime() {
  const pending = new Set<(reason: Error) => void>();
  let closed: Error | null = null;
  return {
    run<T>(start: () => Promise<T>): Promise<T> {
      if (closed) return Promise.reject(closed);
      return new Promise<T>((resolve, reject) => {
        pending.add(reject);
        const cleanup = () => pending.delete(reject);
        try {
          start().then(
            (result) => { cleanup(); resolve(result); },
            (error) => { cleanup(); reject(error); },
          );
        } catch (error) { cleanup(); reject(error); }
      });
    },
    close(reason: Error) {
      if (closed) return;
      closed = reason;
      for (const reject of pending) reject(reason);
      pending.clear();
    },
  };
}
