import { Link } from "react-router-dom";

import { useLiveControllerCommands } from "../hooks/useControllerCommands";
import { useLiveStore } from "../stores/liveStore";
import { Button } from "./ui/button";
import { ButtonRow } from "./ui/button-row";
import { Card } from "./ui/card";
import { CheckboxField } from "./ui/checkbox-field";
import { FieldGroup } from "./ui/field-group";
import { Hint } from "./ui/hint";
import { Label } from "./ui/label";
import { LiveScanPanel, LiveScanRow, LiveYawMeter } from "./ui/live-feedback";
import { ProgressBar } from "./ui/progress";
import { Select } from "./ui/select";

export function LiveRouteControlsPanel() {
  const commands = useLiveControllerCommands();
  const snapshot = useLiveStore((state) => state.snapshot);
  const route = snapshot?.route.route || "2d";
  const mode3d = snapshot?.route.mode3d || "view";
  const recon = snapshot?.recon;
  const is3d = route === "3d";
  const hasModel = Boolean(recon?.has3dModel);
  const projectable = Boolean(recon?.projectable);
  const scanning = Boolean(recon?.scanActive);
  const twinActive = mode3d === "twin";
  const projectionLabel = mode3d === "project" ? "返回 3D 模型" : "投影到画面";
  const projectionDisabled = !hasModel || (!projectable && mode3d !== "project");

  return (
    <>
      <Card>
        <Label htmlFor="routeSel">显示模式</Label>
        <Select
          id="routeSel"
          className="live-inline-top"
          value={route}
          onChange={(event) => commands.route("route_change", event.currentTarget.value)}
        >
          <option value="2d">2D 贴合（默认，稳定）</option>
          <option value="3d">3D 面部重建</option>
        </Select>
        <Hint className="live-inline-top" id="routeModeHint">
          {snapshot?.route.hint || "当前是 2D 实时贴合模式，只显示稳定主流程。"}
        </Hint>
        <FieldGroup id="route3dPanel" className="live-stack" visible={is3d}>
          <Button
            variant="workbench"
            id="reconDemoBtn"
            type="button"
            hidden
            aria-hidden="true"
            tabIndex={-1}
            disabled
            onClick={() => commands.route("load_demo_recon")}
          />
          <ButtonRow className="live-two-col mode-actions">
            <Button variant="workbenchPrimary" id="reconScanBtn" type="button" disabled={scanning} onClick={() => commands.route("start_scan")}>扫描人脸重建</Button>
            <Button variant="workbench" id="project3dBtn" type="button" disabled={projectionDisabled} aria-pressed={mode3d === "project"} onClick={() => commands.route("project_3d")}>{projectionLabel}</Button>
          </ButtonRow>
          <Hint id="reconStatus">{recon?.status || "请缓慢左右转头完成 3D 重建；完成后可旋转查看，或投影回实时画面。"}</Hint>
          <LiveScanPanel id="scanPanel" visible={scanning}>
            <LiveScanRow><span>扫描进度</span><span id="scanProgressVal">0%</span></LiveScanRow>
            <ProgressBar fillProps={{ id: "scanProgressBar" }} />
            <LiveScanRow><span>角度覆盖</span><span id="scanYawVal">0.00</span></LiveScanRow>
            <LiveYawMeter>
              <span id="scanYawLeft" />
              <span id="scanYawMid" />
              <span id="scanYawRight" />
            </LiveYawMeter>
          </LiveScanPanel>
          <ButtonRow className="live-two-col" visible={false}>
            <Button variant="workbench" id="view3dBtn" type="button" disabled={!hasModel} aria-pressed={mode3d === "view"} onClick={() => commands.route("view_3d")}>旋转查看</Button>
          </ButtonRow>
          <Button variant="workbench" id="reset3dBtn" type="button" visible={false} disabled={!hasModel} onClick={() => commands.route("reset_3d")}>复位视角</Button>
          <Button variant="workbenchPrimary" id="cloudFitFlameBtn" type="button" visible={false} disabled={scanning} onClick={() => commands.route("start_twin")}>实时 3D 随动</Button>
          <CheckboxField
            id="flameHeadToggleWrap"
            hiddenClassName="live-hidden-inline"
            visible={twinActive}
            checkboxProps={{
              id: "flameStdToggle",
              checked: recon?.twinMode === "standard",
              onChange: (event) => commands.route("toggle_twin_head", event.currentTarget.checked),
            }}
          >
            显示标准头（取消勾选 = 个体）
          </CheckboxField>
          <CheckboxField
            id="twinTextureWrap"
            hiddenClassName="live-hidden-inline"
            visible={twinActive}
            checkboxProps={{
              id: "twinTextureToggle",
              checked: Boolean(recon?.twinTexture),
              onChange: (event) => commands.route("toggle_twin_texture", event.currentTarget.checked),
            }}
          >
            贴真实人脸纹理
          </CheckboxField>
        </FieldGroup>
      </Card>

      <Card id="threeDWorkflowCard" visible={is3d}>
        <div>
        <Label>图谱标注与闭合模拟</Label>
        <Hint className="live-inline-top">在 3D 标准脸上绘制 RSTL 候选线，并从标注页进入闭合张力模拟。</Hint>
        </div>
        <Button asChild variant="workbenchPrimary">
          <Link to="/annotate">打开 3D 线标注</Link>
        </Button>
      </Card>
    </>
  );
}
