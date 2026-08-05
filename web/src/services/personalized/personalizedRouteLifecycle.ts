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
