import { ReactPage, ReactShell, ReactShellMain } from "../components/ReactShell";
import { ThreePreviewScene } from "../components/ThreePreviewScene";
import { ThreePreviewSidebar } from "../components/ThreePreviewSidebar";
import { useReactRouteLifecycle } from "../hooks/useReactRouteLifecycle";
import { useStandardFaceAssets } from "../hooks/useStandardFaceAssets";

export function ThreePreviewRoute() {
  useReactRouteLifecycle({
    workspace: "three-preview",
    mountedStatus: "三维模型预览加载中",
    unloadedStatus: "三维模型预览已卸载",
  });

  const { assets, loadingText, reload } = useStandardFaceAssets({
    failedRouteStatus: "三维模型预览加载失败",
    initialLoadingText: "正在加载标准脸资产",
    loadedAssetStatus: "标准三维模型资产已加载",
    loadedRouteStatus: "三维模型预览已就绪",
    loadingAssetStatus: "标准三维模型资产加载中",
    loadingRouteStatus: "三维模型预览加载中",
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
