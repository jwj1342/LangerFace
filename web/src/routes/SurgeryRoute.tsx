import { useCallback, useState } from "react";

import { SurgeryR3FScene, type SurgeryCommand, type SurgeryVerdictTone } from "./SurgeryR3FScene";
import { SurgeryWorkbench } from "./SurgeryWorkbench";
import { ReactRouteHost } from "../components/ReactShell";
import { useReactRouteLifecycle } from "../hooks/useReactRouteLifecycle";
import { useStandardFaceAssets } from "../hooks/useStandardFaceAssets";
import { useAppStore } from "../stores/appStore";

export function SurgeryRoute() {
  const [activeCut, setActiveCut] = useState<"along" | null>(null);
  const [command, setCommand] = useState<SurgeryCommand | null>(null);
  const [hint, setHint] = useState("正在加载闭合演示资产。");
  const [lesionState, setLesionState] = useState("默认在脸颊");
  const [showLines, setShowLines] = useState(true);
  const [sizePct, setSizePct] = useState(110);
  const [tensionScore, setTensionScore] = useState<number | null>(null);
  const [verdict, setVerdict] = useState("点击沿 RSTL 切除后，观察闭合区域新增张力如何局部集中。");
  const [verdictTone, setVerdictTone] = useState<SurgeryVerdictTone>("neutral");
  const setRouteStatus = useAppStore((state) => state.setRouteStatus);
  const handleAssetFailure = useCallback((message: string) => setHint(message), []);
  const { assets, loadingText } = useStandardFaceAssets({
    failedRouteStatus: "闭合演示加载失败",
    initialLoadingText: "正在加载标准脸资产",
    loadedAssetStatus: "闭合演示资产已加载",
    loadedRouteStatus: "R3F 闭合演示已就绪",
    loadedText: "闭合演示资产已加载",
    loadingAssetStatus: "闭合演示资产加载中",
    loadingRouteStatus: "加载 R3F 闭合演示资产",
    onFailure: handleAssetFailure,
  });
  useReactRouteLifecycle({
    workspace: "surgery",
    mountedStatus: "加载 R3F 闭合演示资产",
    unloadedStatus: "闭合演示已卸载",
    reactManaged: true,
  });

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
    <ReactRouteHost workspace="surgery">
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
    </ReactRouteHost>
  );
}
