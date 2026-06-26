import { useState } from "react";

import { dispatchControllerCommand } from "../lib/controllerCommand";
import { useLiveStore } from "../stores/liveStore";

const LIVE_RENDER_REACT_COMMAND_EVENT = "langerface:live-render-react-command";

function dispatchRenderCommand(command: string, value?: string | number | boolean) {
  dispatchControllerCommand(LIVE_RENDER_REACT_COMMAND_EVENT, { command, value });
}

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
          <label className="field-label" htmlFor="templateSel">模板</label>
          <select
            id="templateSel"
            className="select live-inline-top"
            defaultValue={render?.system || "rstl"}
            onChange={(event) => dispatchRenderCommand("template_change", event.currentTarget.value)}
          >
            <option value="rstl">面部 RSTL 指南（首选）</option>
          </select>
          <p className={`hint${atlasPreview?.active ? "" : " hidden"}`} id="atlasProvenance">
            {atlasPreview?.active ? `${atlasPreview.source || "标注会话"} · ${atlasPreview.count ?? 0} 条线` : ""}
          </p>
          <button className={`btn${atlasPreview?.active ? "" : " hidden"}`} id="restoreAtlasBtn" type="button" onClick={() => dispatchRenderCommand("restore_atlas")}>恢复官方图谱</button>
        </div>
        <div>
          <label className="field-label" htmlFor="density">线密度 <span className="val" id="densityVal">{density}%</span></label>
          <input
            type="range"
            id="density"
            min="12"
            max="100"
            value={density}
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              setDensity(value);
              dispatchRenderCommand("density_input", value);
            }}
          />
        </div>
        <div className="hidden">
          <label className="field-label" htmlFor="smooth">平滑 <span className="val" id="smoothVal">{render?.smoothLabel || "中"}</span></label>
          <input type="range" id="smooth" min="0" max="100" defaultValue="60" />
        </div>
        <div>
          <label className="field-label" htmlFor="opacity">透明度 <span className="val" id="opacityVal">{opacity}%</span></label>
          <input
            type="range"
            id="opacity"
            min="25"
            max="100"
            value={opacity}
            onChange={(event) => {
              const value = Number(event.currentTarget.value);
              setOpacity(value);
              dispatchRenderCommand("opacity_input", value);
            }}
          />
        </div>
      </div>

      <div className="card">
        <label className="check hidden"><input type="checkbox" id="clip" defaultChecked /> 限制在面部轮廓内（背面剔除）</label>
        <label className="check hidden"><input type="checkbox" id="handOcc" defaultChecked /> 前方手部遮挡（仅识别手部）</label>
        <label className="check">
          <input type="checkbox" id="mirror" checked={mirror} onChange={(event) => dispatchRenderCommand("mirror_toggle", event.currentTarget.checked)} /> 镜像（自拍视角）
        </label>
        <label className="check hidden"><input type="checkbox" id="bands" /> 按面部分区着色</label>
        <label className="check hidden"><input type="checkbox" id="zoom" defaultChecked /> 细节放大窗（关键区域）</label>
        <label className="check">
          <input type="checkbox" id="meshPts" checked={meshPts} onChange={(event) => dispatchRenderCommand("mesh_points_toggle", event.currentTarget.checked)} /> 显示网格采样点
        </label>
      </div>
    </>
  );
}
