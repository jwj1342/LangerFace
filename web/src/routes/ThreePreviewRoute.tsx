import { useEffect, useState } from "react";

import { loadJsonAsset } from "../../assets.js";
import { ThreePreviewScene, type PreviewRstlAtlas, type PreviewTriangle, type PreviewVec3, type ThreePreviewAssets } from "../components/ThreePreviewScene";
import { ThreePreviewSidebar } from "../components/ThreePreviewSidebar";
import { useAppStore } from "../stores/appStore";

export function ThreePreviewRoute() {
  const [assets, setAssets] = useState<ThreePreviewAssets | null>(null);
  const [loadingText, setLoadingText] = useState("正在加载标准脸资产");
  const setActiveWorkspace = useAppStore((state) => state.setActiveWorkspace);
  const setRouteStatus = useAppStore((state) => state.setRouteStatus);
  const setAssetStatus = useAppStore((state) => state.setAssetStatus);

  useEffect(() => {
    let disposed = false;
    setActiveWorkspace("three-preview");
    setRouteStatus("R3F 预览加载中");

    Promise.all([
      loadJsonAsset<PreviewVec3[]>("canonicalVertices", { label: "标准脸顶点", onProgress: (evt) => setLoadingText(`${evt.label} 加载中`) }),
      loadJsonAsset<PreviewTriangle[]>("triangles", { label: "三角拓扑", onProgress: (evt) => setLoadingText(`${evt.label} 加载中`) }),
      loadJsonAsset<PreviewRstlAtlas>("atlasRstl", { label: "RSTL 图谱", onProgress: (evt) => setLoadingText(`${evt.label} 加载中`) }),
    ]).then(([verts, tris, atlas]) => {
      if (disposed) return;
      setAssets({ verts, tris, atlas });
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
      setRouteStatus("R3F 预览已卸载");
    };
  }, [setActiveWorkspace, setAssetStatus, setRouteStatus]);

  return (
    <div className="react-page">
      <div className="react-shell">
        <ThreePreviewSidebar isReady={Boolean(assets)} onReload={() => window.location.reload()} />
        <main className="react-shell-main">
          <ThreePreviewScene assets={assets} loadingText={loadingText} />
        </main>
      </div>
    </div>
  );
}
