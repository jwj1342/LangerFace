import { PencilLine, RotateCcw, ScanSearch } from "lucide-react";

import { useWorkflowIncisionToolCommands } from "../hooks/useControllerCommands";
import { useIncisionStore } from "../stores/incisionStore";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export function WorkflowCanvasTools() {
  const commands = useWorkflowIncisionToolCommands();
  const snapshot = useIncisionStore((state) => state.snapshot);
  const tools = snapshot?.workflowTools;
  const markerMode = tools?.controlledMarkerMode || false;
  const cutaneous = snapshot?.tumor.kind === "cutaneous";
  const markerUnavailable = !markerMode && (!tools?.photoReady || !cutaneous);

  return (
    <div className="workflow-canvas-tools" role="toolbar" aria-label="切口画布工具">
        <Button
          size="sm"
          type="button"
          disabled={markerUnavailable}
          aria-busy={tools?.markerBusy || false}
          aria-pressed={markerMode}
          title={!cutaneous
            ? "受控标记仅用于皮表肿物"
            : !tools?.photoReady
              ? "请先上传并完成人脸检测"
              : "点击照片中的受控黑色标记并识别边界"}
          onClick={() => commands.tool("controlled_marker")}
        >
          <ScanSearch size={15} /><span>{markerMode ? "退出标记" : "受控标记"}</span>
        </Button>
        {markerMode ? (
          <label className="workflow-marker-scan" title="受控标记扫描直径">
            <span>扫描 {tools?.scanDiameterMm || 20} mm</span>
            <Input
              type="range"
              min={tools?.minimumScanDiameterMm || 10}
              max="60"
              step="5"
              value={tools?.scanDiameterMm || 20}
              onChange={(event) => commands.tool("scan_diameter_changed", event.currentTarget.value)}
            />
          </label>
        ) : null}
        <Button
          size="sm"
          type="button"
          disabled={tools?.markerBusy || !tools?.repairAvailable}
          aria-pressed={tools?.repairMode || false}
          title="补充照片中可见但不连续的肿物边缘"
          onClick={() => commands.tool("repair_marker")}
        >
          <PencilLine size={15} /><span>补线</span>
        </Button>
        <Button
          size="sm"
          type="button"
          disabled={tools?.markerBusy || !tools?.repairCount}
          title="清除全部人工补线"
          onClick={() => commands.tool("clear_repair")}
        >
          <span>清除补线</span>
        </Button>
        <Button
          size="sm"
          type="button"
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
    <svg id="workflowIncisionOverlay" className="workflow-incision-overlay" aria-hidden="true">
      <path data-workflow-boundary />
      <path data-workflow-candidate />
      <circle data-workflow-center r="6" />
      <g data-workflow-repairs />
      <g data-workflow-marker-scan style={{ display: "none" }}>
        <circle data-workflow-marker-scan-circle />
        <text data-workflow-marker-scan-label textAnchor="middle">扫描 20 mm</text>
      </g>
    </svg>
  );
}
