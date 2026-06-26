import { ReactPage, ReactShell, ReactShellMain } from "../components/ReactShell";
import { ThreePreviewScene } from "../components/ThreePreviewScene";
import { ThreePreviewSidebar } from "../components/ThreePreviewSidebar";
import { useReactRouteLifecycle } from "../hooks/useReactRouteLifecycle";
import { useStandardFaceAssets } from "../hooks/useStandardFaceAssets";

export function ThreePreviewRoute() {
  useReactRouteLifecycle({
    workspace: "three-preview",
    mountedStatus: "R3F 预览加载中",
    unloadedStatus: "R3F 预览已卸载",
  });

  const { assets, loadingText, reload } = useStandardFaceAssets({
    failedRouteStatus: "R3F 预览加载失败",
    initialLoadingText: "正在加载标准脸资产",
    loadedAssetStatus: "R3F 标准脸资产已加载",
    loadedRouteStatus: "R3F 预览已就绪",
    loadingAssetStatus: "R3F 标准脸资产加载中",
    loadingRouteStatus: "R3F 预览加载中",
  });

  return (
    <ReactPage>
      <ReactShell>
        <ThreePreviewSidebar isReady={Boolean(assets)} onReload={reload} />
        <ReactShellMain>
          <ThreePreviewScene assets={assets} loadingText={loadingText} />
        </ReactShellMain>
      </ReactShell>
    </ReactPage>
  );
}
