import { useEffect, useState } from "react";

import { ReactPage, ReactShell, ReactShellMain } from "../components/ReactShell";
import { ThreePreviewScene, type ThreePreviewAssets } from "../components/ThreePreviewScene";
import { ThreePreviewSidebar } from "../components/ThreePreviewSidebar";
import { useReactRouteLifecycle } from "../hooks/useReactRouteLifecycle";
import { loadStandardFaceAssets } from "../services/standardFaceAssets";
import { useAppStore } from "../stores/appStore";

export function ThreePreviewRoute() {
  const [assets, setAssets] = useState<ThreePreviewAssets | null>(null);
  const [loadingText, setLoadingText] = useState("正在加载标准脸资产");
  const [reloadSerial, setReloadSerial] = useState(0);
  const setRouteStatus = useAppStore((state) => state.setRouteStatus);
  const setAssetStatus = useAppStore((state) => state.setAssetStatus);
  useReactRouteLifecycle({
    workspace: "three-preview",
    mountedStatus: "R3F 预览加载中",
    unloadedStatus: "R3F 预览已卸载",
  });

  useEffect(() => {
    let disposed = false;
    setAssets(null);
    setLoadingText("正在加载标准脸资产");
    setAssetStatus("R3F 标准脸资产加载中");
    setRouteStatus("R3F 预览加载中");

    loadStandardFaceAssets({
      onProgress: (evt) => setLoadingText(`${evt.label || "标准脸资产"} 加载中`),
    }).then((loadedAssets) => {
      if (disposed) return;
      setAssets(loadedAssets);
      setAssetStatus("R3F 标准脸资产已加载");
      setRouteStatus("R3F 预览已就绪");
    }).catch((err) => {
      if (disposed) return;
      setLoadingText(`资产加载失败：${err.message}`);
      setRouteStatus("R3F 预览加载失败");
      console.error(err);
    });

    return () => {
      disposed = true;
    };
  }, [reloadSerial, setAssetStatus, setRouteStatus]);

  return (
    <ReactPage>
      <ReactShell>
        <ThreePreviewSidebar isReady={Boolean(assets)} onReload={() => setReloadSerial((serial) => serial + 1)} />
        <ReactShellMain>
          <ThreePreviewScene assets={assets} loadingText={loadingText} />
        </ReactShellMain>
      </ReactShell>
    </ReactPage>
  );
}
