import { useCallback, useEffect, useState } from "react";

import { loadJsonAsset } from "../../assets.js";
import type { RstlAtlas } from "../../rstl_field.js";
import type { Triangle, Vec3 } from "../../soft_body.js";
import { SurgeryR3FScene, type SurgeryAssets, type SurgeryCommand, type SurgeryVerdictTone } from "./SurgeryR3FScene";
import { SurgeryWorkbench } from "./SurgeryWorkbench";
import { useAppStore } from "../stores/appStore";

export function SurgeryRoute() {
  const [activeCut, setActiveCut] = useState<"along" | null>(null);
  const [assets, setAssets] = useState<SurgeryAssets | null>(null);
  const [command, setCommand] = useState<SurgeryCommand | null>(null);
  const [hint, setHint] = useState("正在加载闭合演示资产。");
  const [lesionState, setLesionState] = useState("默认在脸颊");
  const [loadingText, setLoadingText] = useState("正在加载标准脸资产");
  const [showLines, setShowLines] = useState(true);
  const [sizePct, setSizePct] = useState(110);
  const [tensionScore, setTensionScore] = useState<number | null>(null);
  const [verdict, setVerdict] = useState("点击沿 RSTL 切除后，观察闭合区域新增张力如何局部集中。");
  const [verdictTone, setVerdictTone] = useState<SurgeryVerdictTone>("neutral");
  const setActiveWorkspace = useAppStore((state) => state.setActiveWorkspace);
  const setAssetStatus = useAppStore((state) => state.setAssetStatus);
  const setRouteStatus = useAppStore((state) => state.setRouteStatus);

  useEffect(() => {
    const previousManagedFlag = window.__LANGERFACE_REACT_MANAGED__;
    let disposed = false;

    async function loadSurgeryAssets() {
      window.__LANGERFACE_REACT_MANAGED__ = true;
      setActiveWorkspace("surgery");
      setRouteStatus("加载 R3F 闭合演示资产");
      const [verts, tris, atlas] = await Promise.all([
        loadJsonAsset<Vec3[]>("canonicalVertices", {
          label: "标准脸顶点",
          onProgress: (event) => setLoadingText(`${event.label || "标准脸顶点"} 加载中`),
        }),
        loadJsonAsset<Triangle[]>("triangles", {
          label: "三角拓扑",
          onProgress: (event) => setLoadingText(`${event.label || "三角拓扑"} 加载中`),
        }),
        loadJsonAsset<RstlAtlas>("atlasRstl", {
          label: "RSTL 图谱",
          onProgress: (event) => setLoadingText(`${event.label || "RSTL 图谱"} 加载中`),
        }),
      ]);
      if (disposed) return;
      setAssets({ verts, tris, atlas });
      setAssetStatus("闭合演示资产已加载");
      setRouteStatus("R3F 闭合演示已就绪");
      setLoadingText("闭合演示资产已加载");
    }

    loadSurgeryAssets().catch((err) => {
      if (disposed) return;
      setRouteStatus("闭合演示加载失败");
      setHint(`加载失败：${err.message}`);
      setLoadingText(`资产加载失败：${err.message}`);
      console.error(err);
    });

    return () => {
      disposed = true;
      if (previousManagedFlag === undefined) delete window.__LANGERFACE_REACT_MANAGED__;
      else window.__LANGERFACE_REACT_MANAGED__ = previousManagedFlag;
      setRouteStatus("闭合演示已卸载");
    };
  }, [setActiveWorkspace, setAssetStatus, setRouteStatus]);

  const issueCommand = useCallback((type: SurgeryCommand["type"]) => {
    setCommand((current) => ({ type, serial: (current?.serial || 0) + 1 }));
  }, []);

  const handleExciseAlong = useCallback(() => {
    issueCommand("exciseAlong");
    setRouteStatus("执行沿 RSTL 切除");
  }, [issueCommand, setRouteStatus]);

  const handleReset = useCallback(() => {
    issueCommand("reset");
    setRouteStatus("闭合演示已复位");
  }, [issueCommand, setRouteStatus]);

  const handleVerdictChange = useCallback((nextVerdict: string, tone: SurgeryVerdictTone = "neutral") => {
    setVerdict(nextVerdict);
    setVerdictTone(tone);
    if (tone === "ok" || tone === "warn") setRouteStatus("闭合演示已收敛");
  }, [setRouteStatus]);

  return (
    <div className="react-surgery-host">
      <SurgeryWorkbench
        activeCut={activeCut}
        hint={hint}
        isReady={Boolean(assets)}
        lesionState={lesionState}
        showLines={showLines}
        sizePct={sizePct}
        stage={(
          <SurgeryR3FScene
            assets={assets}
            command={command}
            loadingText={loadingText}
            showLines={showLines}
            sizePct={sizePct}
            onActiveCutChange={setActiveCut}
            onHintChange={setHint}
            onLesionStateChange={setLesionState}
            onTensionChange={setTensionScore}
            onVerdictChange={handleVerdictChange}
          />
        )}
        tensionScore={tensionScore}
        verdict={verdict}
        verdictTone={verdictTone}
        onExciseAlong={handleExciseAlong}
        onReset={handleReset}
        onShowLinesChange={setShowLines}
        onSizeChange={setSizePct}
      />
    </div>
  );
}
