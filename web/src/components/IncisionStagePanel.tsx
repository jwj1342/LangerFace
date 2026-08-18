import { Box, FlipHorizontal2, PencilLine, RotateCcw, ScanSearch, Trash2, Undo2, Upload } from "lucide-react";

import { StageActions, StageCanvas, StageMeta, StageShell, StageStatus, StageViewport } from "./StageShell";
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
            <StageMeta
              id="stageStatus"
              data-tone={snapshot?.stageStatusTone || "normal"}
              aria-live="polite"
            >{snapshot?.stageStatus || ""}</StageMeta>
            <Button asChild size="sm" title={'上传患者静态照片\n当前已上传照片：无'}>
              <label id="incisionPhotoUploadLabel" htmlFor="incisionPhotoInput"><Upload size={15} />照片</label>
            </Button>
            <Input id="incisionPhotoInput" type="file" accept="image/jpeg,image/png" hidden />
            <Button id="controlledMarkerDetectBtn" size="sm" type="button" title="在照片上点击黑点、贴纸或手绘标记" aria-pressed="false">
              <ScanSearch size={15} /><span className="photo-action-label" data-marker-action-label>受控标记</span>
            </Button>
            <label className="controlled-marker-scan-control" htmlFor="controlledMarkerScanDiameter" hidden>
              <span>扫描 <output id="controlledMarkerScanValue">10 mm</output></span>
              <Input
                id="controlledMarkerScanDiameter"
                type="range"
                min="0"
                max="60"
                step="5"
                defaultValue="10"
                aria-label="受控标记扫描直径"
                aria-valuemin={10}
              />
            </label>
            <Button
              id="controlledMarkerRepairBtn"
              size="sm"
              type="button"
              title="补充照片中可见但不连续的肿物边缘"
              aria-pressed="false"
              disabled
            >
              <PencilLine size={15} /><span data-marker-repair-label>补线</span>
            </Button>
            <Button
              id="controlledMarkerRepairUndoBtn"
              size="sm"
              type="button"
              title="撤销上一笔人工补线"
              disabled
            >
              <Undo2 size={15} /><span>撤销补线</span>
            </Button>
            <Button
              id="controlledMarkerRepairClearBtn"
              size="sm"
              type="button"
              title="清除全部人工补线并按原照片重新识别"
              disabled
            >
              <Trash2 size={15} /><span>清除补线</span>
            </Button>
            <Button id="incisionPhotoMirrorBtn" size="sm" type="button" title="水平镜像照片" aria-pressed="false">
              <FlipHorizontal2 size={15} /><span className="photo-action-label">镜像</span>
            </Button>
            <Button id="incisionPhotoResetBtn" size="sm" type="button" title="重置照片缩放与位置">
              <RotateCcw size={15} /><span className="photo-action-label">复位</span>
            </Button>
            <Button id="incisionSurfaceModeBtn" size="sm" type="button" title="切换到三维规划视图">
              <Box size={15} /><span className="photo-action-label">三维视图</span>
            </Button>
          </StageActions>
        </>
      )}
    >
      <StageViewport>
        <canvas id="incisionCanvas"></canvas>
        <StageCanvas id="incisionPhotoCanvas" aria-label="患者照片切口规划画布" />
        <canvas id="incisionCandidateCanvas" aria-hidden="true"></canvas>
        <div id="controlledMarkerScanOverlay" className="controlled-marker-scan-overlay" aria-hidden="true" hidden>
          <span id="controlledMarkerScanOverlayLabel">扫描 10 mm</span>
        </div>
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
        <span className="incision-stage-boundary">三维规划视图仅用于研究，不是患者三维重建</span>
      </StageViewport>
    </StageShell>
  );
}
