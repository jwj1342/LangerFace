import { Camera, Download, ImagePlus, Pause, Play, RotateCw, ScanLine } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { useIncisionControllerCommands, useLiveControllerCommands } from "../hooks/useControllerCommands";
import {
  resetMobileWorkflowVisibility,
  setMobileIncisionCandidateVisible,
} from "../services/mobileWorkflowVisibility";
import { useIncisionStore } from "../stores/incisionStore";
import { useLiveStore } from "../stores/liveStore";
import { Button } from "./ui/button";
import { FieldValue, Label } from "./ui/label";
import { RangeInput } from "./ui/slider";

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
  select.dispatchEvent(new Event("change", { bubbles: true }));
}

export function MobileCanvasQualityBadge() {
  const [quality, setQuality] = useState("未开始 0%");

  useEffect(() => {
    const source = document.querySelector<HTMLElement>("#qualityVal");
    if (!source) return;
    const sync = () => setQuality(source.textContent?.trim() || "未开始 0%");
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(source, { characterData: true, childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return (
    <aside className="mobile-canvas-quality" aria-label="画面质量参考" aria-live="polite">
      <span>跟踪质量参考</span>
      <strong>{quality}</strong>
      <small>受分辨率与光线影响</small>
    </aside>
  );
}

export function MobileWorkflowControls() {
  const liveCommands = useLiveControllerCommands();
  const liveSnapshot = useLiveStore((state) => state.snapshot);
  const [mode, setMode] = useState<WrinkleDisplayMode>("both");
  const [incisionVisible, setIncisionVisible] = useState(true);
  const flags = useMemo(() => displayModeFlags(mode), [mode]);
  const running = Boolean(liveSnapshot?.source.running);
  const paused = Boolean(liveSnapshot?.source.paused);
  const recording = Boolean(liveSnapshot?.recording);
  const hasSource = running || Boolean(liveSnapshot?.source.kind);

  useEffect(() => {
    const select = document.querySelector<HTMLSelectElement>("#wrinkleDisplayMode");
    const sync = () => setMode(readWrinkleDisplayMode());
    sync();
    select?.addEventListener("change", sync);
    return () => select?.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    setMobileIncisionCandidateVisible(incisionVisible);
  }, [incisionVisible]);

  useEffect(() => resetMobileWorkflowVisibility, []);

  const toggleWrinkleLayer = (layer: "rstl" | "wrinkles") => {
    const nextRstl = layer === "rstl" ? !flags.rstl : flags.rstl;
    const nextWrinkles = layer === "wrinkles" ? !flags.wrinkles : flags.wrinkles;
    if (!nextRstl && !nextWrinkles) return;
    const nextMode: WrinkleDisplayMode = nextRstl && nextWrinkles
      ? "both"
      : nextRstl ? "rstl" : "wrinkles";
    setMode(nextMode);
    writeWrinkleDisplayMode(nextMode);
  };

  return (
    <section className="mobile-workflow-dock" aria-label="移动端常用操作">
      <div className="mobile-workflow-section">
        <div className="mobile-workflow-heading">
          <span>输入</span>
          <small>{liveSnapshot?.source.liveLabel || "待机"}</small>
        </div>
        <div className="mobile-source-grid">
          <Button variant="workbenchPrimary" type="button" onClick={() => liveCommands.source("upload_source")}>
            <ImagePlus size={15} /> 上传照片
          </Button>
          <Button
            variant="workbench"
            type="button"
            aria-pressed={running && liveSnapshot?.source.kind === "camera"}
            onClick={() => liveCommands.source("camera_toggle")}
          >
            <Camera size={15} /> 后置摄像头
          </Button>
          <Button variant="workbench" type="button" disabled={!running} onClick={() => liveCommands.source("pause_toggle")}>
            {paused ? <Play size={15} /> : <Pause size={15} />} {paused ? "继续" : "暂停"}
          </Button>
          <Button
            variant="workbench"
            type="button"
            disabled={!hasSource}
            aria-pressed={recording || undefined}
            onClick={() => liveCommands.source("recording_toggle")}
          >
            <Download size={15} /> {recording ? "停止导出" : "导出"}
          </Button>
        </div>
      </div>
      <div className="mobile-workflow-section">
        <div className="mobile-workflow-heading">
          <span>叠加图层</span>
          <small>至少保留一项 RSTL / 皱纹</small>
        </div>
        <div className="mobile-layer-grid">
          <Button
            variant="workbench"
            type="button"
            className="mobile-layer-toggle"
            aria-pressed={flags.rstl}
            onClick={() => toggleWrinkleLayer("rstl")}
          >
            RSTL
          </Button>
          <Button
            variant="workbench"
            type="button"
            className="mobile-layer-toggle"
            aria-pressed={flags.wrinkles}
            onClick={() => toggleWrinkleLayer("wrinkles")}
          >
            皱纹
          </Button>
          <Button
            variant="workbench"
            type="button"
            className="mobile-layer-toggle"
            aria-pressed={incisionVisible}
            onClick={() => setIncisionVisible((visible) => !visible)}
          >
            切口线
          </Button>
        </div>
      </div>
    </section>
  );
}

export function MobileCandidateAdjustPanel() {
  const commands = useIncisionControllerCommands();
  const snapshot = useIncisionStore((state) => state.snapshot);
  const edit = snapshot?.edit;
  const candidateReady = snapshot?.candidate?.type === "fusiform";
  const [scalePct, setScalePct] = useState("100");
  const [angleDeg, setAngleDeg] = useState("0");

  useEffect(() => {
    if (!edit) return;
    setScalePct(String(Math.max(edit.lengthScalePct, edit.widthScalePct)));
    setAngleDeg(String(edit.angleOffsetDeg));
  }, [edit?.angleOffsetDeg, edit?.lengthScalePct, edit?.widthScalePct]);

  const previewUniformScale = (value: string) => {
    commands.edit("preview_edit", "lengthScale", value);
    commands.edit("preview_edit", "widthScale", value);
  };
  const commitUniformScale = (value: string) => {
    commands.edit("commit_edit", "lengthScale", value);
    commands.edit("commit_edit", "widthScale", value);
  };

  return (
    <section className="mobile-candidate-adjust" aria-label="移动端候选调整">
      <header>
        <div>
          <span>候选微调</span>
          <small>中心点固定 · 仅调整梭形草案</small>
        </div>
        <ScanLine size={18} aria-hidden="true" />
      </header>
      <div className="mobile-adjust-field">
        <Label htmlFor="mobileFusiformScale">切缘范围 <FieldValue>{scalePct}%</FieldValue></Label>
        <RangeInput
          id="mobileFusiformScale"
          min="100"
          max="150"
          step="1"
          value={scalePct}
          disabled={!candidateReady}
          onInput={(event) => {
            const value = event.currentTarget.value;
            setScalePct(value);
            previewUniformScale(value);
          }}
          onPointerUp={(event) => commitUniformScale(event.currentTarget.value)}
          onKeyUp={(event) => commitUniformScale(event.currentTarget.value)}
          onBlur={(event) => commitUniformScale(event.currentTarget.value)}
          onChange={(event) => setScalePct(event.currentTarget.value)}
        />
        <small>长度和宽度等比放大，不移动中心、不改变当前方向。</small>
      </div>
      <div className="mobile-adjust-field">
        <Label htmlFor="mobileFusiformAngle">切口方向 <FieldValue>{Number(angleDeg) > 0 ? "+" : ""}{angleDeg}°</FieldValue></Label>
        <RangeInput
          id="mobileFusiformAngle"
          min="-35"
          max="35"
          step="1"
          value={angleDeg}
          disabled={!candidateReady}
          onInput={(event) => {
            const value = event.currentTarget.value;
            setAngleDeg(value);
            commands.edit("preview_edit", "angleOffsetDeg", value);
          }}
          onPointerUp={(event) => commands.edit("commit_edit", "angleOffsetDeg", event.currentTarget.value)}
          onKeyUp={(event) => commands.edit("commit_edit", "angleOffsetDeg", event.currentTarget.value)}
          onBlur={(event) => commands.edit("commit_edit", "angleOffsetDeg", event.currentTarget.value)}
          onChange={(event) => setAngleDeg(event.currentTarget.value)}
        />
        <small>拖动滑杆，以病灶中心为轴心旋转，不移动中心或改变梭形大小。</small>
      </div>
      <Button variant="workbench" type="button" disabled={!candidateReady} onClick={() => commands.edit("reset_edit")}>
        <RotateCw size={15} /> 恢复工具建议
      </Button>
      <p>{candidateReady ? "调整后审阅状态会回到待医生确认。" : "生成梭形候选后可在此调整。"}</p>
    </section>
  );
}
