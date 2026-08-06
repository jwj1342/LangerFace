export type IncisionSessionToken = number;

export interface IncisionSessionGuard {
  mount(): IncisionSessionToken;
  dispose(): void;
  isActive(token: IncisionSessionToken): boolean;
}

export function createIncisionSessionGuard(): IncisionSessionGuard {
  let nextToken = 0;
  let activeToken: IncisionSessionToken | null = null;

  return {
    mount(): IncisionSessionToken {
      activeToken = ++nextToken;
      return activeToken;
    },
    dispose(): void {
      activeToken = null;
    },
    isActive(token: IncisionSessionToken): boolean {
      return activeToken === token;
    },
  };
}
