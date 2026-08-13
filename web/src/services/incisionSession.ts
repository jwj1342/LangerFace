export type IncisionSessionToken = number;

export interface IncisionSessionGuard {
  mount(): IncisionSessionToken;
  dispose(): void;
  isActive(token: IncisionSessionToken): boolean;
}

interface IncisionSessionAssetLoaders<THead, TStandardAtlas, TPersonalizedAtlas> {
  loadHead(): Promise<THead>;
  loadStandardAtlas(): Promise<TStandardAtlas>;
  takePreviewAtlas(): TPersonalizedAtlas;
}

export interface IncisionSessionAssets<THead, TStandardAtlas, TPersonalizedAtlas> {
  head: THead;
  standardAtlas: TStandardAtlas;
  personalizedAtlas: TPersonalizedAtlas;
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

export async function loadIncisionSessionAssets<
  THead,
  TStandardAtlas,
  TPersonalizedAtlas,
>(
  session: IncisionSessionToken,
  isActive: (token: IncisionSessionToken) => boolean,
  loaders: IncisionSessionAssetLoaders<THead, TStandardAtlas, TPersonalizedAtlas>,
): Promise<IncisionSessionAssets<THead, TStandardAtlas, TPersonalizedAtlas> | null> {
  const [head, standardAtlas] = await Promise.all([
    loaders.loadHead(),
    loaders.loadStandardAtlas(),
  ]);
  if (!isActive(session)) return null;

  return {
    head,
    standardAtlas,
    personalizedAtlas: loaders.takePreviewAtlas(),
  };
}
