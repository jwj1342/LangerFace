export type AnnotationSessionToken = number;

export interface AnnotationSessionGuard {
  mount(): AnnotationSessionToken;
  current(): AnnotationSessionToken | null;
  dispose(): void;
  isMounted(): boolean;
  isActive(token: AnnotationSessionToken): boolean;
}

export function createAnnotationSessionGuard(): AnnotationSessionGuard {
  let mounted = false;
  let nextToken = 0;
  let activeSession: AnnotationSessionToken | null = null;

  return {
    mount(): AnnotationSessionToken {
      mounted = true;
      activeSession = ++nextToken;
      return activeSession;
    },
    current(): AnnotationSessionToken | null {
      return activeSession;
    },
    dispose(): void {
      mounted = false;
      activeSession = null;
    },
    isMounted(): boolean {
      return mounted;
    },
    isActive(token: AnnotationSessionToken): boolean {
      return mounted && activeSession === token;
    },
  };
}
