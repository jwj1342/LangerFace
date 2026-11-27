import { Camera, Download, Ellipsis, ImagePlus, Pause, Play, ScanLine } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { useIncisionControllerCommands, useLiveControllerCommands } from "../hooks/useControllerCommands";
import {
  setMobileIncisionCandidateVisible,
  setMobileRstlLayerVisible,
  setMobileWrinkleLayerVisible,
  subscribeWorkflowLayerVisibility,
  workflowLayerVisibilitySnapshot,
} from "../services/mobileWorkflowVisibility";
import { setWrinkleDisplayMode } from "../services/liveWrinkleAnalysis";
import type { CameraFacingSelection } from "../services/cameraSource";
import { workflowCameraPhotoRequired, workflowPhotoCameraEnabled } from "../services/workflowPhotoCamera";
import { useIncisionStore } from "../stores/incisionStore";
import { useLiveStore } from "../stores/liveStore";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { FieldValue, Label } from "./ui/label";
import { Select } from "./ui/select";
import { RangeInput } from "./ui/slider";
import { WorkflowMobileSection, useWorkflowMobilePanels, type WorkflowMobilePanel } from "./WorkflowMobilePanels";

type WrinkleDisplayMode = "rstl" | "wrinkles" | "both";

function displayModeFlags(mode: WrinkleDisplayMode) {
  return {
    rstl: mode === "rstl" || mode === "both",
    wrinkles: mode === "wrinkles" || mode === "both",
  };
}

function readWrinkleDisplayMode(): WrinkleDisplayMode {
  const value = document.querySelector<HTMLSelectElement>("#wrinkleDisplayMode")?.value;
  return value === "rstl" || value === "wrinkles" ? value : "both";
}

function writeWrinkleDisplayMode(mode: WrinkleDisplayMode) {
  const select = document.querySelector<HTMLSelectElement>("#wrinkleDisplayMode");
  if (!select) return;
  select.value = mode;
  // Keep the legacy control state in sync without dispatching a second redraw.
  setWrinkleDisplayMode(mode, { redraw: false });
}

export function MobileWorkflowControls() {
  const panels = useWorkflowMobilePanels();
  const togglePanel = (name: WorkflowMobilePanel) => panels?.select(panels.selected === name ? null : name);
  const liveCommands = useLiveControllerCommands();
  const liveSnapshot = useLiveStore((state) => state.snapshot);
  const sourceControlsReady = liveSnapshot !== null;
  const running = Boolean(liveSnapshot?.source.running);
  const paused = Boolean(liveSnapshot?.source.paused);
  const recording = Boolean(liveSnapshot?.recording);
  const cameraActive = running && liveSnapshot?.source.kind === "camera";
  const cameraPending = Boolean(liveSnapshot?.source.cameraPending);
  const [preferredFacing, setPreferredFacing] = useState<CameraFacingSelection>("environment");
  const activeFacing = liveSnapshot?.source.cameraFacing;
  const selectedFacing = cameraActive && activeFacing && activeFacing !== "unknown" ? activeFacing : preferredFacing;
  const photoReady = useIncisionStore((state) => state.snapshot?.workflowTools?.photoReady);
  const cameraBlocked = workflowPhotoCameraEnabled && !cameraActive && !(photoReady && liveSnapshot?.source.kind === "image");
  const hasSource = running || Boolean(liveSnapshot?.source.kind);

  useEffect(() => {
    if (!cameraActive || workflowPhotoCameraEnabled) return;
    // Camera startup resets the wrinkle runtime. Re-apply the visible phone
    // controls afterwards so their pressed state and both render gates agree.
    setMobileRstlLayerVisible(true);
    setMobileWrinkleLayerVisible(true);
    writeWrinkleDisplayMode("both");
  }, [cameraActive]);

  return (
    <>
      <WorkflowMobileSection panel="texture">
        <WorkflowLayerVisibilityButtons className="mobile-layer-grid" mobile layers={["rstl", "wrinkles"]} />
      </WorkflowMobileSection>
      <WorkflowMobileSection panel="incision">
        <WorkflowLayerVisibilityButtons className="mobile-layer-grid" mobile layers={["incision"]} />
      </WorkflowMobileSection>
      <WorkflowMobileSection panel="more">
        <div className="mobile-source-grid">
          <Button variant="workbench" type="button" disabled={!running} onClick={() => liveCommands.source("pause_toggle")}>
            {paused ? <Play size={15} /> : <Pause size={15} />} {paused ? "继续" : "暂停"}
          </Button>
          <Button variant="workbench" type="button" disabled={!hasSource} aria-pressed={recording || undefined} onClick={() => liveCommands.source("recording_toggle")}>
            <Download size={15} /> {recording ? "停止视频" : "导出视频"}
          </Button>
          <Button variant="workbench" type="button" disabled={!hasSource} onClick={() => liveCommands.source("image_export")}>
            <ImagePlus size={15} /> 导出图片
          </Button>
        </div>
        {workflowPhotoCameraEnabled && (
          <div className="mobile-camera-selection">
            <Label htmlFor="mobileCameraFacing">摄像头</Label>
            <Select
              id="mobileCameraFacing"
              value={selectedFacing}
              disabled={!sourceControlsReady || cameraPending}
              onChange={(event) => {
                const facing = event.currentTarget.value;
                if (facing !== "user" && facing !== "environment") return;
                setPreferredFacing(facing);
                if (cameraActive) liveCommands.source("camera_toggle", { facing, switchCamera: true });
              }}
            >
              <option value="environment">后置</option>
              <option value="user">前置</option>
            </Select>
            <label className="mobile-camera-mirror">
              <Checkbox
                checked={Boolean(cameraActive && liveSnapshot?.render.mirror)}
                disabled={!cameraActive || cameraPending || paused}
                onChange={(event) => liveCommands.render("mirror_toggle", event.currentTarget.checked)}
              />
              水平镜像
            </label>
          </div>
        )}
        {workflowPhotoCameraEnabled && liveSnapshot?.source.cameraError && (
          <small className="mobile-camera-error" role="status">{liveSnapshot.source.cameraError}</small>
        )}
      </WorkflowMobileSection>
      <section className="mobile-workflow-dock" aria-label="移动端常用操作">
        <nav className="mobile-workflow-tabs" aria-label="工具分组">
          <button type="button" aria-expanded={panels?.selected === "texture"} onClick={() => togglePanel("texture")}>皮肤纹理</button>
          <button type="button" aria-expanded={panels?.selected === "incision"} onClick={() => togglePanel("incision")}>切口设计</button>
        </nav>
        <div className="mobile-camera-actions">
          <Button variant="workbench" type="button" className="mobile-camera-action" aria-pressed={cameraActive}
            disabled={cameraBlocked || cameraPending}
            title={cameraBlocked ? workflowCameraPhotoRequired : undefined}
            onClick={() => liveCommands.source("camera_toggle",
              workflowPhotoCameraEnabled && !cameraActive ? { facing: selectedFacing } : undefined)}>
            <Camera size={24} /><span>{cameraPending ? "摄像头准备中…" : cameraActive
              ? (workflowPhotoCameraEnabled ? "关闭摄像头" : "关闭后置摄像头")
              : (workflowPhotoCameraEnabled && selectedFacing === "user" ? "开启前置摄像头" : "开启后置摄像头")}</span>
          </Button>
          <Button variant="workbenchPrimary" type="button" className="mobile-upload-action" disabled={!sourceControlsReady || cameraPending}
            title={sourceControlsReady ? undefined : "工作台正在初始化，请稍候"}
            onClick={() => liveCommands.source("upload_source")}>
            <span className="mobile-upload-ring"><ImagePlus size={26} /></span><span>上传照片</span>
          </Button>
          <Button variant="workbench" type="button" className="mobile-more-action" aria-expanded={panels?.selected === "more"} onClick={() => togglePanel("more")}>
            <Ellipsis size={25} /><span>更多</span>
          </Button>
        </div>
      </section>
    </>
  );
}

export function WorkflowLayerVisibilityButtons({ className = "", mobile = false, layers = ["rstl", "wrinkles", "incision"] }: {
  className?: string;
  mobile?: boolean;
  layers?: readonly ("rstl" | "wrinkles" | "incision")[];
}) {
  const visibility = useSyncExternalStore(
    subscribeWorkflowLayerVisibility,
    workflowLayerVisibilitySnapshot,
    workflowLayerVisibilitySnapshot,
  );

  useEffect(() => {
    const select = document.querySelector<HTMLSelectElement>("#wrinkleDisplayMode");
    const sync = () => {
      const flags = displayModeFlags(readWrinkleDisplayMode());
      setMobileRstlLayerVisible(flags.rstl);
      setMobileWrinkleLayerVisible(flags.wrinkles);
    };
    select?.addEventListener("change", sync);
    return () => select?.removeEventListener("change", sync);
  }, []);

  const toggleWrinkleLayer = (layer: "rstl" | "wrinkles") => {
    const nextRstl = layer === "rstl" ? !visibility.rstl : visibility.rstl;
    const nextWrinkles = layer === "wrinkles" ? !visibility.wrinkles : visibility.wrinkles;
    setMobileRstlLayerVisible(nextRstl);
    setMobileWrinkleLayerVisible(nextWrinkles);
    if (nextRstl || nextWrinkles) {
      writeWrinkleDisplayMode(nextRstl && nextWrinkles ? "both" : nextRstl ? "rstl" : "wrinkles");
    }
  };

  return (
    <div className={`workflow-layer-grid ${className}`.trim()} role="group" aria-label="叠加图层显示开关">
      {layers.includes("rstl") && <Button variant="workbench" type="button" className={mobile ? "mobile-layer-toggle" : "workflow-layer-toggle"} aria-pressed={visibility.rstl} onClick={() => toggleWrinkleLayer("rstl")}>RSTL</Button>}
      {layers.includes("wrinkles") && <Button variant="workbench" type="button" className={mobile ? "mobile-layer-toggle" : "workflow-layer-toggle"} aria-pressed={visibility.wrinkles} onClick={() => toggleWrinkleLayer("wrinkles")}>皱纹</Button>}
      {layers.includes("incision") && <Button variant="workbench" type="button" className={mobile ? "mobile-layer-toggle" : "workflow-layer-toggle"} aria-pressed={visibility.incision} onClick={() => setMobileIncisionCandidateVisible(!visibility.incision)}>切口线</Button>}
    </div>
  );
}

export function MobileCandidateAdjustPanel() {
  const commands = useIncisionControllerCommands();
  const snapshot = useIncisionStore((state) => state.snapshot);
  const cameraMode = useLiveStore((state) => state.snapshot?.source.kind === "camera");
  const edit = snapshot?.edit;
  const candidateReady = Boolean(edit?.widthScaleVisible);
  const [scalePct, setScalePct] = useState("0");
  const [angleDeg, setAngleDeg] = useState("0");
  const cancelledGesture = useRef({ uniformScale: false, angleOffsetDeg: false });

  useEffect(() => {
    if (!edit) return;
    setScalePct(String(Math.max(0, Math.max(edit.lengthScalePct, edit.widthScalePct) - 100)));
    setAngleDeg(String(edit.angleOffsetDeg));
  }, [edit?.angleOffsetDeg, edit?.lengthScalePct, edit?.widthScalePct]);

  const previewUniformScale = (value: string) => {
    commands.edit("preview_edit", "uniformScale", value);
  };
  const commitUniformScale = (value: string) => {
    commands.edit("commit_edit", "uniformScale", value);
  };

  return (
    <section className="mobile-candidate-adjust" aria-label="移动端候选调整">
      <header>
        <div>
          <span>候选微调</span>
          <small>绕切口中心调整 · 仅调整梭形草案</small>
        </div>
        <ScanLine size={18} aria-hidden="true" />
      </header>
      <div className="mobile-adjust-field">
        <Label htmlFor="mobileFusiformScale">梭形整体缩放 <FieldValue>{scalePct}%</FieldValue></Label>
        <RangeInput
          id="mobileFusiformScale"
          min="0"
          max="50"
          step="1"
          value={scalePct}
          disabled={cameraMode || !candidateReady}
          onPointerDown={() => { cancelledGesture.current.uniformScale = false; }}
          onInput={(event) => {
            const value = event.currentTarget.value;
            setScalePct(value);
            previewUniformScale(value);
          }}
          onPointerUp={(event) => {
            cancelledGesture.current.uniformScale = false;
            commitUniformScale(event.currentTarget.value);
          }}
          onPointerCancel={() => {
            cancelledGesture.current.uniformScale = true;
            commands.edit("cancel_edit", "uniformScale");
          }}
          onKeyUp={(event) => commitUniformScale(event.currentTarget.value)}
          onBlur={(event) => {
            if (cancelledGesture.current.uniformScale) {
              cancelledGesture.current.uniformScale = false;
              return;
            }
            commitUniformScale(event.currentTarget.value);
          }}
          onChange={(event) => setScalePct(event.currentTarget.value)}
        />
        <small>0% 为基础梭形；长度和宽度围绕中心等比放大，不替代以毫米记录的医学安全切缘。</small>
      </div>
      <div className="mobile-adjust-field">
        <Label htmlFor="mobileFusiformAngle">切口方向 <FieldValue>{Number(angleDeg) > 0 ? "+" : ""}{angleDeg}°</FieldValue></Label>
        <RangeInput
          id="mobileFusiformAngle"
          min="-35"
          max="35"
          step="1"
          value={angleDeg}
          disabled={cameraMode || !candidateReady}
          onPointerDown={() => { cancelledGesture.current.angleOffsetDeg = false; }}
          onInput={(event) => {
            const value = event.currentTarget.value;
            setAngleDeg(value);
            commands.edit("preview_edit", "angleOffsetDeg", value);
          }}
          onPointerUp={(event) => {
            cancelledGesture.current.angleOffsetDeg = false;
            commands.edit("commit_edit", "angleOffsetDeg", event.currentTarget.value);
          }}
          onPointerCancel={() => {
            cancelledGesture.current.angleOffsetDeg = true;
            commands.edit("cancel_edit", "angleOffsetDeg");
          }}
          onKeyUp={(event) => commands.edit("commit_edit", "angleOffsetDeg", event.currentTarget.value)}
          onBlur={(event) => {
            if (cancelledGesture.current.angleOffsetDeg) {
              cancelledGesture.current.angleOffsetDeg = false;
              return;
            }
            commands.edit("commit_edit", "angleOffsetDeg", event.currentTarget.value);
          }}
          onChange={(event) => setAngleDeg(event.currentTarget.value)}
        />
        <small>拖动滑杆，以切口中心为轴心旋转；保持 3:1 并重新包住肿物，人工方向优先。</small>
      </div>
    </section>
  );
}
