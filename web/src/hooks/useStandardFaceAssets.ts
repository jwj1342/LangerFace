import { useCallback, useEffect, useState } from "react";

import { loadStandardFaceAssets, type StandardFaceAssets } from "../services/standardFaceAssets";
import { useAppStore } from "../stores/appStore";

interface UseStandardFaceAssetsOptions {
  failedRouteStatus: string;
  initialLoadingText: string;
  loadedAssetStatus: string;
  loadedRouteStatus: string;
  loadedText?: string;
  loadingAssetStatus: string;
  loadingRouteStatus: string;
  progressFallbackLabel?: string;
  onFailure?: (message: string) => void;
}

interface StandardFaceAssetsState {
  assets: StandardFaceAssets | null;
  loadingText: string;
  reload: () => void;
}

function formatAssetError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function useStandardFaceAssets({
  failedRouteStatus,
  initialLoadingText,
  loadedAssetStatus,
  loadedRouteStatus,
  loadedText,
  loadingAssetStatus,
  loadingRouteStatus,
  progressFallbackLabel = "标准脸资产",
  onFailure,
}: UseStandardFaceAssetsOptions): StandardFaceAssetsState {
  const [assets, setAssets] = useState<StandardFaceAssets | null>(null);
  const [loadingText, setLoadingText] = useState(initialLoadingText);
  const [reloadSerial, setReloadSerial] = useState(0);
  const setAssetStatus = useAppStore((state) => state.setAssetStatus);
  const setRouteStatus = useAppStore((state) => state.setRouteStatus);
  const reload = useCallback(() => setReloadSerial((serial) => serial + 1), []);

  useEffect(() => {
    let disposed = false;
    setAssets(null);
    setLoadingText(initialLoadingText);
    setAssetStatus(loadingAssetStatus);
    setRouteStatus(loadingRouteStatus);

    loadStandardFaceAssets({
      onProgress: (event) => {
        if (disposed) return;
        setLoadingText(`${event.label || progressFallbackLabel} 加载中`);
      },
    }).then((loadedAssets) => {
      if (disposed) return;
      setAssets(loadedAssets);
      setAssetStatus(loadedAssetStatus);
      setRouteStatus(loadedRouteStatus);
      if (loadedText) setLoadingText(loadedText);
    }).catch((error) => {
      if (disposed) return;
      const message = formatAssetError(error);
      setRouteStatus(failedRouteStatus);
      setLoadingText(`资产加载失败：${message}`);
      onFailure?.(`加载失败：${message}`);
      console.error(error);
    });

    return () => {
      disposed = true;
    };
  }, [
    failedRouteStatus,
    initialLoadingText,
    loadedAssetStatus,
    loadedRouteStatus,
    loadedText,
    loadingAssetStatus,
    loadingRouteStatus,
    onFailure,
    progressFallbackLabel,
    reloadSerial,
    setAssetStatus,
    setRouteStatus,
  ]);

  return { assets, loadingText, reload };
}
