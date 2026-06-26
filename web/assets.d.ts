export interface AssetProgressEvent {
  key?: string;
  label?: string;
  url?: string;
  phase?: "start" | "progress" | "done";
  loaded?: number;
  total?: number | null;
  ratio?: number | null;
}

export interface AssetUrls {
  canonicalVertices: string;
  topology: string;
  flameBasis: string;
  [key: string]: string;
}

export const assetUrls: AssetUrls;

export function assetBaseUrl(): string;

export function assetUrl(key: string): string;

export function loadJsonAsset<T = unknown>(
  key: string,
  options?: {
    label?: string;
    onProgress?: (event: AssetProgressEvent) => void;
  },
): Promise<T>;

export function loadArrayBufferAsset(
  key: string,
  options?: {
    label?: string;
    onProgress?: (event: AssetProgressEvent) => void;
  },
): Promise<ArrayBuffer>;
