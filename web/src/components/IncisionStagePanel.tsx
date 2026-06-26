import { Link } from "react-router-dom";

import { useIncisionStore, type IncisionAssetLoadingState } from "../stores/incisionStore";

const DEFAULT_ASSET_LOADING: IncisionAssetLoadingState = {
  visible: true,
  text: "准备下载标准脸、拓扑和 RSTL 图谱。",
};

export function IncisionStagePanel() {
  const snapshot = useIncisionStore((state) => state.snapshot);
  const assetLoading = snapshot?.assetLoading || DEFAULT_ASSET_LOADING;

  return (
    <main className="stage">
      <div className="stage-top">
        <span className="live on"><span className="dot"></span>标准脸规划</span>
        <div className="stage-actions">
          <span className="fps" id="stageStatus">{snapshot?.stageStatus || "拖拽旋转 · 滚轮缩放 · 点击定位"}</span>
          <Link className="stage-link fps" to="/annotate">3D 标注与演示</Link>
        </div>
      </div>
      <div className="stage-body">
        <div className="main-wrap">
          <canvas id="agentCanvas"></canvas>
          <div className={`asset-loading${assetLoading.visible ? "" : " hidden"}`} id="assetLoading" role="status" aria-live="polite">
            <div className="asset-spinner" aria-hidden="true"></div>
            <strong>正在加载切口规划资产</strong>
            <p id="assetLoadingText">{assetLoading.text}</p>
          </div>
          <div className="canvas-legend" aria-label="3D 标注图例">
            <span className="legend-item"><span className="legend-swatch center"></span>病灶中心</span>
            <span className="legend-item"><span className="legend-swatch ring"></span>肿物范围</span>
            <span className="legend-item"><span className="legend-swatch line"></span>候选切口</span>
            <span className="legend-item"><span className="legend-swatch handle"></span>端点控制</span>
          </div>
        </div>
      </div>
    </main>
  );
}
