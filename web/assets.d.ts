export interface AssetProgressEvent {
  key?: string;
  label?: string;
  url?: string;
  phase?: "start" | "progress" | "done";
  loaded?: number;
  total?: number | null;
  ratio?: number | null;
}

export function loadJsonAsset<T = unknown>(
  key: string,
  options?: {
    label?: string;
    onProgress?: (event: AssetProgressEvent) => void;
  },
): Promise<T>;
