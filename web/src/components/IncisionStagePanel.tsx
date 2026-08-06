import { Box, FlipHorizontal2, RotateCcw, Upload } from "lucide-react";

import { StageActions, StageCanvas, StageLink, StageMeta, StageShell, StageStatus, StageViewport } from "./StageShell";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { CanvasLegendItem, Legend } from "./ui/legend";
import { AssetLoadingOverlay } from "./ui/loading-overlay";
import { useIncisionStore, type IncisionAssetLoadingState } from "../stores/incisionStore";

const DEFAULT_ASSET_LOADING: IncisionAssetLoadingState = {
  visible: true,
  text: "准备加载 MediaPipe 面部拓扑、个体化 RSTL 和切口规划资产。",
};

export function IncisionStagePanel() {
  const snapshot = useIncisionStore((state) => state.snapshot);
  const assetLoading = snapshot?.assetLoading || DEFAULT_ASSET_LOADING;

  return (
    <StageShell
      top={(
        <>
          <StageStatus active>{snapshot?.headAsset.statusLabel || "个体化 RSTL 规划"}</StageStatus>
          <StageActions>
            <StageMeta id="stageStatus">{snapshot?.stageStatus || "拖拽旋转 · 滚轮缩放 · 点击定位"}</StageMeta>
            <Button asChild size="sm" title="上传患者静态照片">
              <label htmlFor="incisionPhotoInput"><Upload size={15} />照片</label>
            </Button>
            <Input id="incisionPhotoInput" type="file" accept="image/jpeg,image/png" hidden />
            <Button id="incisionPhotoMirrorBtn" size="sm" type="button" title="水平镜像照片" aria-pressed="false">
              <FlipHorizontal2 size={15} /><span className="photo-action-label">镜像</span>
            </Button>
            <Button id="incisionPhotoResetBtn" size="sm" type="button" title="重置照片缩放与位置">
              <RotateCcw size={15} /><span className="photo-action-label">复位</span>
            </Button>
            <Button id="incisionSurfaceModeBtn" size="sm" type="button" title="切换到标准三维规划表面">
              <Box size={15} /><span className="photo-action-label">标准表面</span>
            </Button>
            <StageLink variant="meta" to="/settings/atlas">图谱库管理</StageLink>
          </StageActions>
        </>
      )}
    >
      <StageViewport>
        <canvas id="incisionCanvas"></canvas>
        <StageCanvas id="incisionPhotoCanvas" aria-label="患者照片切口规划画布" />
        <div className="incision-photo-endpoint-layer" role="group" aria-label="候选切口端点">
          <button className="incision-photo-endpoint-handle" type="button" data-endpoint-index="0" aria-label="拖动候选切口起点" title="拖动候选切口起点" hidden />
          <button className="incision-photo-endpoint-handle" type="button" data-endpoint-index="1" aria-label="拖动候选切口终点" title="拖动候选切口终点" hidden />
        </div>
        <div id="incisionPhotoStatus" className="photo-planning-status" role="status" aria-live="polite">
          上传 JPEG 或 PNG 照片后在患者面部直接规划
        </div>
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
