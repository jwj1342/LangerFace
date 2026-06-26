import { useState } from "react";

import { dispatchLiveRenderCommand } from "../lib/controllerCommand";
import { useLiveStore } from "../stores/liveStore";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Label } from "./ui/label";
import { Select } from "./ui/select";
import { RangeInput } from "./ui/slider";

export function LiveRenderControlsPanel() {
  const snapshot = useLiveStore((state) => state.snapshot);
  const render = snapshot?.render;
  const atlasPreview = snapshot?.atlasPreview;
  const [density, setDensity] = useState(render?.densityPct || 100);
  const [opacity, setOpacity] = useState(render?.opacityPct || 92);
  const mirror = render?.mirror ?? true;
  const meshPts = render?.meshPts ?? false;

  return (
    <>
      <div className="card">
        <div>
          <Label htmlFor="templateSel">模板</Label>
          <Select
            id="templateSel"
            className="live-inline-top"
            defaultValue={render?.system || "rstl"}
            onChange={(event) => dispatchLiveRenderCommand("template_change", event.currentTarget.value)}
          >
            <option value="rstl">面部 RSTL 指南（首选）</option>
          </Select>
          <p className={`hint${atlasPreview?.active ? "" : " hidden"}`} id="atlasProvenance">
            {atlasPreview?.active ? `${atlasPreview.source || "标注会话"} · ${atlasPreview.count ?? 0} 条线` : ""}
          </p>
          <Button variant="workbench" className={atlasPreview?.active ? "" : "hidden"} id="restoreAtlasBtn" type="button" onClick={() => dispatchLiveRenderCommand("restore_atlas")}>恢复官方图谱</Button>
        </div>
        <div>
          <Label htmlFor="density">线密度 <span className="val" id="densityVal">{density}%</span></Label>
          <RangeInput
            id="density"
            min="12"
            max="100"
            value={density}
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              setDensity(value);
              dispatchLiveRenderCommand("density_input", value);
            }}
          />
        </div>
        <div className="hidden">
          <Label htmlFor="smooth">平滑 <span className="val" id="smoothVal">{render?.smoothLabel || "中"}</span></Label>
          <RangeInput id="smooth" min="0" max="100" defaultValue="60" />
        </div>
        <div>
          <Label htmlFor="opacity">透明度 <span className="val" id="opacityVal">{opacity}%</span></Label>
          <RangeInput
            id="opacity"
            min="25"
            max="100"
            value={opacity}
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              setOpacity(value);
              dispatchLiveRenderCommand("opacity_input", value);
            }}
          />
        </div>
      </div>

      <div className="card">
        <label className="check hidden"><Checkbox id="clip" defaultChecked /> 限制在面部轮廓内（背面剔除）</label>
        <label className="check hidden"><Checkbox id="handOcc" defaultChecked /> 前方手部遮挡（仅识别手部）</label>
        <label className="check">
          <Checkbox id="mirror" checked={mirror} onChange={(event) => dispatchLiveRenderCommand("mirror_toggle", event.currentTarget.checked)} /> 镜像（自拍视角）
        </label>
        <label className="check hidden"><Checkbox id="bands" /> 按面部分区着色</label>
        <label className="check hidden"><Checkbox id="zoom" defaultChecked /> 细节放大窗（关键区域）</label>
        <label className="check">
          <Checkbox id="meshPts" checked={meshPts} onChange={(event) => dispatchLiveRenderCommand("mesh_points_toggle", event.currentTarget.checked)} /> 显示网格采样点
        </label>
      </div>
    </>
  );
}
