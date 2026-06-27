import { StageActions, StageLink, StageMeta, StageShell, StageStatus, StageViewport } from "./StageShell";
import { CanvasLegendItem, Legend } from "./ui/legend";
import { AssetLoadingOverlay } from "./ui/loading-overlay";
import { useIncisionStore, type IncisionAssetLoadingState } from "../stores/incisionStore";

const DEFAULT_ASSET_LOADING: IncisionAssetLoadingState = {
  visible: true,
  text: "准备下载 FLAME/MediaPipe 头模、拓扑和 RSTL 图谱。",
};

export function IncisionStagePanel() {
  const snapshot = useIncisionStore((state) => state.snapshot);
  const assetLoading = snapshot?.assetLoading || DEFAULT_ASSET_LOADING;

  return (
    <StageShell
      top={(
        <>
          <StageStatus active>{snapshot?.headAsset.statusLabel || "头模规划"}</StageStatus>
          <StageActions>
            <StageMeta id="stageStatus">{snapshot?.stageStatus || "拖拽旋转 · 滚轮缩放 · 点击定位"}</StageMeta>
            <StageLink variant="meta" to="/annotate">3D 标注与演示</StageLink>
          </StageActions>
        </>
      )}
    >
      <StageViewport>
        <canvas id="agentCanvas"></canvas>
        <AssetLoadingOverlay
          id="assetLoading"
          heading="正在加载切口规划资产"
          text={assetLoading.text}
          textProps={{ id: "assetLoadingText" }}
          visible={assetLoading.visible}
        />
        <Legend variant="canvas" aria-label="3D 标注图例">
          <CanvasLegendItem swatchClassName="center">病灶中心</CanvasLegendItem>
          <CanvasLegendItem swatchClassName="ring">肿物范围</CanvasLegendItem>
          <CanvasLegendItem swatchClassName="line">候选切口</CanvasLegendItem>
          <CanvasLegendItem swatchClassName="handle">端点控制</CanvasLegendItem>
        </Legend>
      </StageViewport>
    </StageShell>
  );
}
