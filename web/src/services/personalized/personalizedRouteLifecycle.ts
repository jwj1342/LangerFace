export type PersonalizedRuntimeResourceKind = "landmarker" | "wrinkleYolo";

export interface PersonalizedRuntimeResource {
  close(): void | Promise<void>;
}

export interface PersonalizedRuntimeLease {
  readonly generation: number;
  readonly signal: AbortSignal;
  isActive(): boolean;
  get<T extends PersonalizedRuntimeResource>(kind: PersonalizedRuntimeResourceKind): T | null;
  adopt(kind: PersonalizedRuntimeResourceKind, resource: PersonalizedRuntimeResource): boolean;
}

export interface PersonalizedRouteLifecycle {
  mount(): PersonalizedRuntimeLease;
  dispose(): void;
}

export interface StoppableMediaStream {
  getTracks(): readonly { stop(): void }[];
}

export function stopMediaStream(stream: StoppableMediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}

export async function requestCameraStreamForLease<T extends StoppableMediaStream>(
  lease: Pick<PersonalizedRuntimeLease, "isActive">,
  constraints: readonly MediaStreamConstraints[],
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<T>,
): Promise<T | null> {
  let lastError: unknown = new Error("无法打开摄像头");
  for (const candidateConstraints of constraints) {
    if (!lease.isActive()) return null;
    try {
      const candidate = await getUserMedia(candidateConstraints);
      if (!lease.isActive()) {
        stopMediaStream(candidate);
        return null;
      }
      return candidate;
    } catch (error) {
      lastError = error;
      if (!lease.isActive()) return null;
    }
  }
  throw lastError;
}

type ReleaseErrorHandler = (kind: PersonalizedRuntimeResourceKind, error: unknown) => void;

export function createPersonalizedRouteLifecycle(
  onReleaseError: ReleaseErrorHandler = () => {},
): PersonalizedRouteLifecycle {
  let generation = 0;
  let activeState: {
    generation: number;
    controller: AbortController;
    resources: Map<PersonalizedRuntimeResourceKind, PersonalizedRuntimeResource>;
  } | null = null;

  const release = (
    kind: PersonalizedRuntimeResourceKind,
    resource: PersonalizedRuntimeResource,
  ): void => {
    try {
      const result = resource.close();
      if (result && typeof result.then === "function") {
        void result.catch((error) => onReleaseError(kind, error));
      }
    } catch (error) {
      onReleaseError(kind, error);
    }
  };

  const dispose = (): void => {
    const state = activeState;
    activeState = null;
    if (!state) return;
    state.controller.abort();
    for (const [kind, resource] of state.resources) release(kind, resource);
    state.resources.clear();
  };

  return {
    mount(): PersonalizedRuntimeLease {
      dispose();
      const state = {
        generation: ++generation,
        controller: new AbortController(),
        resources: new Map<PersonalizedRuntimeResourceKind, PersonalizedRuntimeResource>(),
      };
      activeState = state;
      const isActive = (): boolean => activeState === state && !state.controller.signal.aborted;
      return {
        generation: state.generation,
        signal: state.controller.signal,
        isActive,
        get<T extends PersonalizedRuntimeResource>(kind: PersonalizedRuntimeResourceKind): T | null {
          return isActive() ? (state.resources.get(kind) as T | undefined) ?? null : null;
        },
        adopt(kind: PersonalizedRuntimeResourceKind, resource: PersonalizedRuntimeResource): boolean {
          if (!isActive()) {
            release(kind, resource);
            return false;
          }
          const previous = state.resources.get(kind);
          if (previous && previous !== resource) release(kind, previous);
          state.resources.set(kind, resource);
          return true;
        },
      };
    },
    dispose,
  };
}
