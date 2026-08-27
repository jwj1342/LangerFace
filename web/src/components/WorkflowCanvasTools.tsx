import { CircleStop, PencilLine, RotateCcw, ScanSearch } from "lucide-react";

import { useWorkflowIncisionToolCommands } from "../hooks/useControllerCommands";
import { FREEHAND_MARKER_DISABLED_MESSAGE } from "../services/incisionClinicalCopy";
import { useIncisionStore } from "../stores/incisionStore";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { CanvasLegendItem, Legend } from "./ui/legend";
import { PersistentTooltip, usePersistentTooltip } from "./ui/persistent-tooltip";

export function WorkflowCanvasTools() {
  const commands = useWorkflowIncisionToolCommands();
  const snapshot = useIncisionStore((state) => state.snapshot);
  const tools = snapshot?.workflowTools;
  const markerMode = tools?.controlledMarkerMode || false;
  const cutaneous = snapshot?.tumor.kind === "cutaneous";
  const freehandMarkerUnavailable = !markerMode
    && cutaneous
    && snapshot?.tumor.boundaryMode === "freehand";
  const markerUnavailable = !markerMode && (!tools?.photoReady || !cutaneous || freehandMarkerUnavailable);
  // Native disabled buttons swallow click/touch events. Keep the freehand-mode
  // block actionable so the controller can explain how to restore the tool.
  const markerHardUnavailable = markerUnavailable && !freehandMarkerUnavailable;
  const markerTooltip = usePersistentTooltip<HTMLButtonElement>(freehandMarkerUnavailable);
  const markerBusy = tools?.markerBusy || false;

  return (
    <div className="workflow-canvas-tools" role="toolbar" aria-label="切口画布工具">
        <Button
          ref={markerTooltip.anchorRef}
          size="sm"
          type="button"
          disabled={markerHardUnavailable || markerBusy}
          aria-disabled={markerUnavailable || markerBusy}
          aria-busy={markerBusy}
          aria-pressed={markerMode}
          aria-describedby={freehandMarkerUnavailable ? "freehandMarkerDisabledTooltip" : undefined}
          className={freehandMarkerUnavailable ? "workflow-disabled-action" : undefined}
          title={freehandMarkerUnavailable
            ? undefined
            : !cutaneous
              ? "受控标记仅用于皮表肿物"
              : !tools?.photoReady
                ? "请先上传并完成人脸检测"
                : "点击照片中的受控黑色标记并识别边界"}
          onPointerEnter={markerTooltip.onPointerEnter}
          onPointerLeave={markerTooltip.onPointerLeave}
          onPointerDown={markerTooltip.onPointerDown}
          onPointerCancel={markerTooltip.showForRelease}
          onFocus={markerTooltip.onFocus}
          onBlur={markerTooltip.onBlur}
          onClick={() => {
            markerTooltip.showForRelease();
            commands.tool("controlled_marker");
          }}
        >
          <ScanSearch size={15} /><span>{markerMode ? "退出标记" : "受控标记"}</span>
        </Button>
        <PersistentTooltip
          anchorRef={markerTooltip.anchorRef}
          id="freehandMarkerDisabledTooltip"
          message={FREEHAND_MARKER_DISABLED_MESSAGE}
          open={markerTooltip.open}
        />
        {markerMode ? (
          <>
            <label className="workflow-marker-scan" title="受控标记扫描直径">
              <span>扫描 {tools?.scanDiameterMm || 20} mm</span>
              <Input
                type="range"
                min={tools?.minimumScanDiameterMm || 10}
                max="60"
                step="5"
                value={tools?.scanDiameterMm || 20}
                disabled={markerBusy}
                onChange={(event) => commands.tool("scan_diameter_changed", event.currentTarget.value)}
              />
            </label>
            {markerBusy ? (
              <Button
                className="workflow-marker-cancel"
                size="sm"
                type="button"
                aria-label="取消当前肿物识别"
                title="停止本次识别并保留当前扫描圆圈和照片位置"
                onClick={() => commands.tool("cancel_controlled_marker")}
              >
                <CircleStop size={15} /><span>取消识别</span>
              </Button>
            ) : null}
            <Button
              className="workflow-mobile-marker-confirm"
              size="sm"
              type="button"
              disabled={markerBusy || !tools?.mobileMarkerPlacementReady}
              aria-label="识别已放置圆圈内的肿物"
              title="先轻触照片放置扫描圆圈，确认位置后再识别"
              onClick={() => commands.tool("confirm_controlled_marker")}
            >
              <ScanSearch size={15} /><span>{markerBusy ? "识别中" : "识别此处"}</span>
            </Button>
          </>
        ) : null}
        <Button
          size="sm"
          type="button"
          disabled={markerBusy || !tools?.repairAvailable}
          aria-pressed={tools?.repairMode || false}
          title="补充照片中可见但不连续的肿物边缘"
          onClick={() => commands.tool("repair_marker")}
        >
          <PencilLine size={15} /><span>补线</span>
        </Button>
        <Button
          size="sm"
          type="button"
          disabled={markerBusy || !tools?.repairCount}
          title="清除全部人工补线"
          onClick={() => commands.tool("clear_repair")}
        >
          <span>清除补线</span>
        </Button>
        <Button
          size="sm"
          type="button"
          disabled={markerBusy}
          title="将照片缩放和位置恢复为初始状态"
          onClick={() => commands.tool("reset_view")}
        >
          <RotateCcw size={15} /><span>复位</span>
        </Button>
    </div>
  );
}

export function WorkflowCanvasOverlay() {
  return (
    <>
      <svg id="workflowIncisionOverlay" className="workflow-incision-overlay" aria-hidden="true">
        <path data-workflow-boundary />
        <path data-workflow-candidate />
        <path data-workflow-diagnostic-candidate />
        <circle data-workflow-center r="6" />
        <g data-workflow-repairs />
        <g data-workflow-marker-scan style={{ display: "none" }}>
          <circle data-workflow-marker-scan-circle />
          <text data-workflow-marker-scan-label textAnchor="middle">扫描 20 mm</text>
        </g>
      </svg>
      <Legend variant="canvas" aria-label="切口标注图例">
        <CanvasLegendItem swatchClassName="center">病灶中心</CanvasLegendItem>
        <CanvasLegendItem swatchClassName="ring">肿物范围</CanvasLegendItem>
        <CanvasLegendItem swatchClassName="line">候选切口</CanvasLegendItem>
        <CanvasLegendItem swatchClassName="handle">端点控制</CanvasLegendItem>
      </Legend>
    </>
  );
}
