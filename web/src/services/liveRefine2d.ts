import { els } from "./liveDom.ts";
import { resetImageView, setRefineCanvasViewActive, stepImageViewZoom } from "./liveCanvasFit.ts";
import type { MappedAtlasLine } from "./geometryAtlas.ts";
import type { Vec3 } from "./softBody";
import {
  applyCurveRefinementTransport,
  applyMirroredCurveDelta,
  buildCurveRefinementTransport,
  curvePointWindow,
  curveEraseTargets,
  deformCurveWide,
  explicitSymmetryPartnerIndex,
  mapRefineViewportPoint,
  moveCurvePoints,
  stabilizeCurveToReference,
  type RefineLine,
  type RefinePoint,
} from "./liveRefineMath.ts";
import {
  renderState,
  sourceState,
  type EditableRefineLine,
  type RefineMode,
  type RefinePick,
} from "./liveState.ts";

const HISTORY_LIMIT = 20;
const clamp = (value: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, value));
const cloneLines = (lines: readonly RefineLine[] | null | undefined): EditableRefineLine[] => (
  (lines || []).map((line) => ({
  name: line.name || "unnamed_curve",
  region: line.region || "",
  symmetryRole: line.symmetryRole || "",
  symmetryPairId: line.symmetryPairId || "",
  hidden: Boolean(line.hidden),
  tris: [...(line.tris || [])],
  pts: (line.pts || []).map((point) => [point[0], point[1], point[2] || 0] as Vec3),
}))
);
const requestRefineFrame = () => window.dispatchEvent(new CustomEvent("langerface:refine2d-redraw"));

function state() {
  return renderState.refine2d;
}
function canvasPoint(event: PointerEvent): [number, number] {
  const rect = els.canvas.getBoundingClientRect();
  let x = (event.clientX - rect.left) * els.canvas.width / Math.max(1, rect.width);
  let y = (event.clientY - rect.top) * els.canvas.height / Math.max(1, rect.height);
  if (renderState.mirror) x = els.canvas.width - x;
  [x, y] = mapRefineViewportPoint(
    [x, y],
    { width: els.canvas.width, height: els.canvas.height },
    renderState.focusCrop,
  );
  return [clamp(x, 0, els.canvas.width), clamp(y, 0, els.canvas.height)];
}

function faceAxisX(): number {
  const lm = (sourceState.imageCacheLM || sourceState.lastLM) as RefinePoint[] | null;
  const candidates: number[] = [];
  if (lm?.[234] && lm?.[454]) candidates.push((lm[234][0] + lm[454][0]) / 2);
  for (const index of [10, 151, 9, 8, 168, 6, 1, 4, 152]) {
    if (lm?.[index]) candidates.push(lm[index][0]);
  }
  if (!candidates.length) return els.canvas.width / 2;
  candidates.sort((a, b) => a - b);
  return candidates[Math.floor(candidates.length / 2)] ?? els.canvas.width / 2;
}

export function symmetryAxisX() {
  return faceAxisX();
}

export function showSymmetryAxis() {
  const s = state();
  return Boolean(s.active && s.showAxis);
}

function sourceLabel() {
  if (sourceState.sourceKind === "image") return "照片";
  if (sourceState.sourceKind === "video") return "视频";
  if (sourceState.sourceKind === "camera") return "摄像头";
  return "未加载";
}

function captureHistory(label: string): void {
  const s = state();
  if (!s.lines) return;
  s.undoStack.push({ label, lines: cloneLines(s.lines) });
  if (s.undoStack.length > HISTORY_LIMIT) s.undoStack.shift();
  updateRefineUi();
}

function markDirty(message: string): void {
  const s = state();
  s.dirty = true;
  els.refine2dHint.textContent = message;
  updateRefineUi();
}

export function setLatestAutoLines(mapped: readonly RefineLine[]): void {
  const s = state();
  // The automatic result is the safety reference for the whole edit session.
  // Keep it frozen while refining; redraws, focus changes, and zoom changes must
  // never move the baseline underneath an in-progress gesture.
  if (!s.latestAutoLines?.length || (!s.active && !s.lines && !s.liveTransport)) {
    s.latestAutoLines = cloneLines(mapped);
  }
  if (s.active && !s.lines) {
    s.lines = cloneLines(mapped);
    s.selected = null;
    updateRefineUi();
  } else if (!s.active && sourceState.paused && s.liveTransport) {
    s.lines = cloneLines(applyCurveRefinementTransport(mapped, s.liveTransport, {
      width: els.canvas.width,
      height: els.canvas.height,
    }));
  }
}

/**
 * Replace the static-frame automatic baseline (standard or wrinkle-guided).
 * Keeping both arrays in lockstep lets a doctor start manual refinement after
 * automatic refinement without changing the safety/reset reference.
 */
export function replaceStaticRefineBaseline(mapped: readonly RefineLine[]): void {
  const s = state();
  s.latestAutoLines = cloneLines(mapped);
  s.lines = cloneLines(mapped);
  s.liveTransport = null;
  s.selected = null;
  s.dirty = false;
  s.undoStack = [];
  s.drag = null;
  updateRefineUi();
  requestRefineFrame();
}

export function hasManualRefineChanges(): boolean {
  return state().dirty;
}

export function getDisplayLines(
  mapped: readonly MappedAtlasLine[],
): Array<MappedAtlasLine & { hidden?: boolean }> {
  const s = state();
  if (s.active) {
    if (!s.lines) setLatestAutoLines(mapped);
    return s.lines || [...mapped];
  }
  if ((sourceState.sourceKind === "image" || sourceState.paused) && s.lines) return s.lines;
  if (s.liveTransport?.system === renderState.system) {
    return applyCurveRefinementTransport(mapped, s.liveTransport, {
      width: els.canvas.width,
      height: els.canvas.height,
    });
  }
  return [...mapped];
}

/** Commit current frozen-frame edits for transport to subsequent live frames. */
export function commitRefineForLive(): boolean {
  const s = state();
  if (!s.latestAutoLines?.length || !s.lines?.length) return false;
  s.liveTransport = {
    ...buildCurveRefinementTransport(s.latestAutoLines, s.lines),
    system: renderState.system,
    committedAt: new Date().toISOString(),
  };
  s.active = false;
  s.mode = "view";
  s.selected = null;
  s.drag = null;
  setRefineCanvasViewActive(false);
  updateRefineUi();
  return true;
}

export function selectedLineIndex(): number | null {
  return state().selected?.lineIndex ?? null;
}

export function selectedPointIndex(): number | null {
  return state().selected?.pointIndex ?? null;
}

export function selectedPointWindow(): { start: number; end: number } | null {
  const s = state();
  const line = s.selected?.lineIndex == null ? null : s.lines?.[s.selected.lineIndex];
  if (!line?.pts.length || !Number.isInteger(s.selected?.pointIndex)) return null;
  return curvePointWindow(line.pts.length, s.selected!.pointIndex, s.pointCount);
}

export function isRefineActive(): boolean {
  return state().active;
}

export function isPointRefineMode(): boolean {
  const s = state();
  return Boolean(s.active && s.mode === "point");
}

export function isLineHidden(lineIndex: number): boolean {
  return Boolean(state().lines?.[lineIndex]?.hidden);
}

export function setRefineAvailability(): void {
  const staticImageReady = sourceState.sourceKind === "image" && Boolean(sourceState.imageCacheLM);
  const frozenLiveReady = (sourceState.sourceKind === "camera" || sourceState.sourceKind === "video")
    && sourceState.paused && Boolean(sourceState.frozenFrame) && Boolean(sourceState.lastLM);
  const ready = sourceState.running && (staticImageReady || frozenLiveReady);
  els.refine2d.disabled = !ready;
  if (!ready && !state().active) {
    els.refine2dHint.textContent = "上传正脸照片，或在摄像头中点击“定格微调”，即可调整当前结果。";
  }
}

export function resetRefineForNewSource(): void {
  const s = state();
  s.active = false;
  s.mode = "view";
  s.spread = 0.28;
  s.pointCount = 1;
  s.nudgeStep = 0.5;
  s.symmetry = false;
  s.showAxis = true;
  s.lines = null;
  s.latestAutoLines = null;
  s.liveTransport = null;
  s.selected = null;
  s.dirty = false;
  s.undoStack = [];
  s.drag = null;
  setRefineCanvasViewActive(false);
  updateRefineUi();
  setRefineAvailability();
}

export function updateRefineUi(): void {
  const s = state();
  els.refine2d.setAttribute("aria-pressed", String(s.active));
  els.refine2d.textContent = s.active ? "退出医生手动微调" : "医生手动微调（2D）";
  els.refine2dPanel.classList.toggle("hidden", !s.active);
  els.mainWrap.classList.toggle("refining", s.active);
  els.mainWrap.classList.toggle("refine-drag", s.active && s.mode === "drag");
  els.mainWrap.classList.toggle("refine-point", s.active && s.mode === "point");
  els.refine2dStatus.textContent = !s.active
    ? "未开始"
    : s.dirty ? "已修改" : "查看中";
  const modeButtons: Array<[HTMLButtonElement, RefineMode]> = [
    [els.refineView, "view"],
    [els.refineDrag, "drag"],
    [els.refinePoint, "point"],
    [els.refineErase, "erase"],
  ];
  for (const [button, mode] of modeButtons) {
    button.setAttribute("aria-pressed", String(s.mode === mode));
  }
  els.refineUndo.disabled = !s.undoStack.length;
  els.refineExport.disabled = !s.active || !s.lines?.length;
  els.refineReset.disabled = !s.active || !s.latestAutoLines?.length;
  const zoomPercent = Math.round(renderState.imageView.zoom * 100);
  els.refineZoomVal.textContent = `${zoomPercent}%`;
  els.refineZoomOut.disabled = !s.active || renderState.imageView.zoom <= renderState.imageView.minZoom + 0.001;
  els.refineZoomReset.disabled = !s.active || Math.abs(renderState.imageView.zoom - 1) < 0.001;
  els.refineZoomIn.disabled = !s.active || renderState.imageView.zoom >= renderState.imageView.maxZoom - 0.001;
  els.refineSpread.value = String(Math.round(s.spread * 100));
  els.refineSpread.disabled = s.mode !== "drag";
  els.refineSpreadVal.textContent = `${Math.round(s.spread * 100)}%`;
  els.refinePointCountWrap.classList.toggle("hidden", s.mode !== "point");
  els.refinePointCount.value = String(s.pointCount);
  els.refinePointCount.disabled = s.mode !== "point";
  els.refinePointCountVal.textContent = `${s.pointCount} 个点`;
  els.refineNudgeStep.value = String(s.nudgeStep);
  for (const button of els.refineNudgeButtons) {
    button.disabled = !s.active || s.selected?.lineIndex == null;
  }
  els.refineSymmetry.checked = s.symmetry;
  els.refineAxis.checked = s.showAxis;
  window.dispatchEvent(new CustomEvent("langerface:refine2d-state"));
}

export function toggleRefine2d(): void {
  const s = state();
  if (s.active) {
    s.active = false;
    s.selected = null;
    setRefineCanvasViewActive(false);
    updateRefineUi();
    requestRefineFrame();
    return;
  }
  const staticImageReady = sourceState.sourceKind === "image" && Boolean(sourceState.imageCacheLM);
  const frozenLiveReady = (sourceState.sourceKind === "camera" || sourceState.sourceKind === "video")
    && sourceState.paused && Boolean(sourceState.frozenFrame) && Boolean(sourceState.lastLM);
  if (!staticImageReady && !frozenLiveReady) {
    els.refine2dHint.textContent = "请先上传照片，或定格一个已检测到人脸的摄像头画面。";
    return;
  }
  s.active = true;
  s.mode = "drag";
  s.lines = s.lines || cloneLines(s.latestAutoLines);
  s.selected = null;
  setRefineCanvasViewActive(true);
  els.refine2dHint.textContent = `${sourceLabel()}结果已进入微调：可拖线或拖点调整。`;
  updateRefineUi();
  requestRefineFrame();
}

export function setRefineMode(mode: RefineMode): void {
  const s = state();
  s.mode = mode;
  s.drag = null;
  els.refine2dHint.textContent = {
    view: "查看模式只允许点选线，避免误改。",
    drag: "拖线：跟随鼠标横向和纵向移动；大幅移动会自动平滑限幅，防止曲线拉出尖峰。",
    point: `拖点：当前连续控制 ${s.pointCount} 个点；中心点完全跟随，两侧平滑递减。`,
    erase: "隐藏：点击不需要的曲线即可隐藏整条线；可用“撤销”恢复。",
  }[mode] || "";
  updateRefineUi();
}

export function setRefineSpread(value: number | string): void {
  const s = state();
  s.spread = clamp(Number(value) / 100, 0.12, 0.6);
  els.refine2dHint.textContent = `拖线联动范围已设为 ${Math.round(s.spread * 100)}%。`;
  updateRefineUi();
}

export function setRefinePointCount(value: number | string): void {
  const s = state();
  s.pointCount = clamp(Math.round(Number(value) || 1), 1, 30);
  els.refine2dHint.textContent = s.pointCount === 1
    ? "拖点范围为单点：只移动当前抓住的采样点。"
    : `拖点范围为 ${s.pointCount} 个点：可对一小段曲线进行连续微调。`;
  updateRefineUi();
  requestRefineFrame();
}

export function setRefineNudgeStep(value: number | string): void {
  state().nudgeStep = clamp(Number(value) || 0.5, 0.25, 2);
  updateRefineUi();
}

export function adjustRefineImageZoom(action: "in" | "out" | "reset"): boolean {
  if (!state().active) return false;
  let changed = false;
  if (action === "reset") {
    changed = Math.abs(renderState.imageView.zoom - 1) >= 0.001;
    resetImageView();
  } else {
    changed = stepImageViewZoom(action === "in" ? 1 : -1);
  }
  if (!changed) return false;
  els.refine2dHint.textContent = `图片缩放已调整为 ${Math.round(renderState.imageView.zoom * 100)}%。`;
  updateRefineUi();
  return true;
}

export function setSymmetryEnabled(enabled: boolean): void {
  const s = state();
  s.symmetry = Boolean(enabled);
  els.refine2dHint.textContent = s.symmetry
    ? "对称联动已开启：拖动一侧线条会同步镜像对应线。"
    : "对称联动已关闭：左右线条可独立微调。";
  updateRefineUi();
  requestRefineFrame();
}

export function setAxisVisible(visible: boolean): void {
  const s = state();
  s.showAxis = Boolean(visible);
  els.refine2dHint.textContent = s.showAxis ? "已显示人脸中线。" : "已隐藏人脸中线。";
  updateRefineUi();
  requestRefineFrame();
}

function nearestPoint(
  lines: readonly EditableRefineLine[],
  point: readonly [number, number],
  maxPx: number,
): RefinePick | null {
  let best: RefinePick | null = null;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    if (!line || line.hidden) continue;
    for (let pointIndex = 0; pointIndex < line.pts.length; pointIndex++) {
      const p = line.pts[pointIndex];
      if (!p) continue;
      const d = Math.hypot(p[0] - point[0], p[1] - point[1]);
      if (d <= maxPx && (!best || d < best.distancePx)) best = { lineIndex, pointIndex, distancePx: d };
    }
  }
  return best;
}

function nearestSegmentLine(
  lines: readonly EditableRefineLine[],
  point: readonly [number, number],
  maxPx: number,
): RefinePick | null {
  let best: RefinePick | null = null;
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    if (!line || line.hidden) continue;
    for (let i = 1; i < line.pts.length; i++) {
      const a = line.pts[i - 1], b = line.pts[i];
      if (!a || !b) continue;
      const dx = b[0] - a[0], dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy || 1;
      const t = clamp(((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / len2, 0, 1);
      const x = a[0] + dx * t, y = a[1] + dy * t;
      const d = Math.hypot(point[0] - x, point[1] - y);
      if (d <= maxPx && (!best || d < best.distancePx)) best = { lineIndex, pointIndex: i, distancePx: d };
    }
  }
  return best;
}

function pickLine(point: readonly [number, number]): RefinePick | null {
  const s = state();
  const maxPx = Math.max(s.mode === "point" ? 14 : 10, els.canvas.width / 90);
  if (s.mode === "point") return nearestPoint(s.lines || [], point, maxPx);
  return nearestPoint(s.lines || [], point, maxPx) || nearestSegmentLine(s.lines || [], point, maxPx);
}

function automaticReferenceForLine(
  line: EditableRefineLine,
  lineIndex: number,
): readonly RefinePoint[] | null {
  const automatic = state().latestAutoLines;
  const indexed = automatic?.[lineIndex];
  if (indexed?.name === line.name && indexed.pts.length === line.pts.length) return indexed.pts;
  return automatic?.find((candidate) => (
    candidate.name === line.name && candidate.pts.length === line.pts.length
  ))?.pts || null;
}

function strongestDisplacementIndex(
  reference: readonly RefinePoint[],
  current: readonly RefinePoint[],
): number {
  let bestIndex = 0;
  let bestDistance = -1;
  for (let index = 0; index < Math.min(reference.length, current.length); index++) {
    const distance = Math.hypot(
      current[index][0] - reference[index][0],
      current[index][1] - reference[index][1],
    );
    if (distance > bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function movePoint(pick: RefinePick, offset: readonly [number, number]): [number, number] {
  const s = state();
  const line = s.lines?.[pick.lineIndex];
  if (!line) return [0, 0];
  const original = s.drag?.original || line.pts.map((point) => [...point]);
  const effectiveOffset: [number, number] = [offset[0], offset[1]];
  if (s.mode === "point") {
    line.pts = moveCurvePoints(original, pick.pointIndex, s.pointCount, effectiveOffset, {
      width: els.canvas.width,
      height: els.canvas.height,
    }).map((point) => [point[0], point[1], point[2] || 0]);
  } else {
    const anchor = original[pick.pointIndex];
    if (!anchor) return [0, 0];
    line.pts = deformCurveWide(original, pick.pointIndex, [
      anchor[0] + effectiveOffset[0],
      anchor[1] + effectiveOffset[1],
    ], {
      width: els.canvas.width,
      height: els.canvas.height,
      spread: s.spread,
    }).map((point) => [point[0], point[1], point[2] || 0]);
    const reference = automaticReferenceForLine(line, pick.lineIndex) || original;
    line.pts = stabilizeCurveToReference(
      reference,
      line.pts,
      { width: els.canvas.width, height: els.canvas.height },
      pick.pointIndex,
    ).map((point) => [point[0], point[1], point[2] || 0]);
  }
  const moved = line.pts[pick.pointIndex];
  const anchor = original[pick.pointIndex];
  return moved && anchor ? [moved[0] - anchor[0], moved[1] - anchor[1]] : [0, 0];
}

function findSymmetryPartner(lineIndex: number): number | null {
  return explicitSymmetryPartnerIndex(state().lines, lineIndex);
}

export function symmetryPartnerIndex(): number | null {
  const s = state();
  if (!s.active || !s.symmetry || s.selected?.lineIndex == null) return null;
  return findSymmetryPartner(s.selected.lineIndex);
}

function syncSymmetryForLine(
  lineIndex: number,
  pointIndex: number | null,
  pointCount: number,
  originalSource: readonly RefinePoint[],
  originalPartner: readonly RefinePoint[] | null,
  partnerIndexOverride: number | null,
): number | null {
  const s = state();
  if (!s.symmetry) return null;
  const lines = s.lines;
  const source = lines?.[lineIndex];
  const partnerIndex = Number.isInteger(partnerIndexOverride)
    ? partnerIndexOverride
    : findSymmetryPartner(lineIndex);
  const partner = partnerIndex == null ? null : lines?.[partnerIndex];
  if (!source || !partner) return null;
  const sourceWindow = Number.isInteger(pointIndex)
    ? curvePointWindow(source.pts.length, pointIndex!, pointCount)
    : null;
  let nextPartner = applyMirroredCurveDelta(
    originalSource,
    source.pts,
    originalPartner || partner.pts,
    faceAxisX(),
    sourceWindow,
    { width: els.canvas.width, height: els.canvas.height },
  );
  if (!sourceWindow) {
    const reference = automaticReferenceForLine(partner, partnerIndex as number) || originalPartner || partner.pts;
    nextPartner = stabilizeCurveToReference(
      reference,
      nextPartner,
      { width: els.canvas.width, height: els.canvas.height },
      strongestDisplacementIndex(reference, nextPartner),
    );
  }
  partner.pts = nextPartner.map((point) => [point[0], point[1], point[2] || 0]);
  return partnerIndex;
}

function eraseLine(pick: RefinePick): void {
  const s = state();
  const lines = s.lines;
  const line = lines?.[pick.lineIndex];
  if (!line) return;
  const partner = findSymmetryPartner(pick.lineIndex);
  const targets = curveEraseTargets(pick.lineIndex, partner, s.symmetry);
  captureHistory(`擦除 ${line.name}`);
  for (const lineIndex of targets) {
    const target = lines[lineIndex];
    if (target) target.hidden = true;
  }
  s.selected = null;
  markDirty(targets.length > 1
    ? `已隐藏 ${line.name} 及其对称线，可点击“撤销”恢复。`
    : `已隐藏整条 ${line.name}，可点击“撤销”恢复。`);
  requestRefineFrame();
}

export function beginRefinePointer(event: PointerEvent): boolean {
  const s = state();
  if (!s.active || !s.lines) return false;
  const point = canvasPoint(event);
  const pick = pickLine(point);
  if (!pick) return false;
  s.selected = pick;
  if (s.mode === "erase") {
    eraseLine(pick);
    return true;
  }
  if (s.mode === "drag" || s.mode === "point") {
    const line = s.lines[pick.lineIndex];
    if (!line) return false;
    const partnerIndex = s.symmetry ? findSymmetryPartner(pick.lineIndex) : null;
    s.drag = {
      pointerId: event.pointerId,
      pick,
      startPointer: point,
      original: line.pts.map((point) => [...point] as Vec3),
      partnerIndex,
      originalPartner: partnerIndex == null
        ? null
        : s.lines[partnerIndex]?.pts.map((partnerPoint) => [...partnerPoint] as Vec3) || null,
      moved: false,
      symmetryLinkedIndex: null,
    };
    els.canvas.setPointerCapture(event.pointerId);
  }
  updateRefineUi();
  requestRefineFrame();
  return true;
}

export function moveRefinePointer(event: PointerEvent): boolean {
  const s = state();
  if (!s.active || !s.drag || s.drag.pointerId !== event.pointerId) return false;
  const current = canvasPoint(event);
  const precision = event.altKey ? 0.25 : 1;
  const offset: [number, number] = [
    (current[0] - s.drag.startPointer[0]) * precision,
    (current[1] - s.drag.startPointer[1]) * precision,
  ];
  if (!s.drag.moved && Math.hypot(offset[0], offset[1]) < 0.01) return true;
  if (!s.drag.moved) {
    const action = s.mode === "point" ? "拖点调整" : "拖线调整";
    captureHistory(`${action} ${s.lines?.[s.drag.pick.lineIndex]?.name || "曲线"}`);
  }
  s.drag.moved = true;
  movePoint(s.drag.pick, offset);
  s.drag.symmetryLinkedIndex = syncSymmetryForLine(
    s.drag.pick.lineIndex,
    s.mode === "point" ? s.drag.pick.pointIndex : null,
    s.pointCount,
    s.drag.original,
    s.drag.originalPartner,
    s.drag.partnerIndex,
  );
  s.selected = s.drag.pick;
  s.dirty = true;
  updateRefineUi();
  requestRefineFrame();
  return true;
}

export function endRefinePointer(event: PointerEvent): boolean {
  const s = state();
  if (!s.active || !s.drag || s.drag.pointerId !== event.pointerId) return false;
  const line = s.lines?.[s.drag.pick.lineIndex];
  const moved = s.drag.moved;
  const symmetryLinked = s.drag.symmetryLinkedIndex != null;
  s.drag = null;
  if (els.canvas.hasPointerCapture(event.pointerId)) els.canvas.releasePointerCapture(event.pointerId);
  if (moved) {
    const symmetryMessage = s.symmetry
      ? symmetryLinked ? "已同步对称线。" : "此曲线未找到可联动的对称线。"
      : "";
    markDirty(line ? `${line.name} 已微调。${symmetryMessage}` : `线条已微调。${symmetryMessage}`);
  } else {
    updateRefineUi();
  }
  requestRefineFrame();
  return true;
}

export function nudgeSelected(direction: string): boolean {
  const s = state();
  const selected = s.selected;
  const line = selected?.lineIndex == null ? null : s.lines?.[selected.lineIndex];
  if (!s.active || !selected || !line) return false;
  const vectors: Record<string, [number, number]> = {
    left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1],
  };
  const vector = vectors[direction];
  if (!vector) return false;
  const visualX = renderState.mirror ? -vector[0] : vector[0];
  const offset: [number, number] = [visualX * s.nudgeStep, vector[1] * s.nudgeStep];
  captureHistory(`精调 ${line.name}`);
  const original = line.pts.map((point) => [...point] as Vec3);
  const partnerIndex = s.symmetry ? findSymmetryPartner(selected.lineIndex) : null;
  const originalPartner = partnerIndex == null
    ? null
    : s.lines?.[partnerIndex]?.pts.map((point) => [...point] as Vec3) || null;
  movePoint(selected, offset);
  const symmetryLinked = syncSymmetryForLine(
    selected.lineIndex,
    s.mode === "point" ? selected.pointIndex : null,
    s.pointCount,
    original,
    originalPartner,
    partnerIndex,
  ) != null;
  const distance = Math.round(Math.hypot(offset[0], offset[1]) * 100) / 100;
  const symmetryMessage = s.symmetry
    ? symmetryLinked ? "已同步对称线。" : "此曲线未找到可联动的对称线。"
    : "";
  markDirty(`${line.name} 已精调 ${distance} px。${symmetryMessage}`);
  requestRefineFrame();
  return true;
}

export function undoRefine(): void {
  const s = state();
  const entry = s.undoStack.pop();
  if (!entry) return;
  s.lines = cloneLines(entry.lines);
  s.selected = null;
  s.dirty = true;
  els.refine2dHint.textContent = `已撤销：${entry.label}`;
  updateRefineUi();
  requestRefineFrame();
}

export function resetRefineToAuto(): void {
  const s = state();
  if (!s.latestAutoLines) return;
  captureHistory("恢复自动结果");
  s.lines = cloneLines(s.latestAutoLines);
  s.selected = null;
  markDirty("已恢复到当前 2D 自动贴合结果。");
  requestRefineFrame();
}

export function exportRefine(): void {
  const payload = buildExportPayload();
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "langer_2d_doctor_refined.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  els.refine2dHint.textContent = "已导出 langer_2d_doctor_refined.json。";
}

function buildExportPayload() {
  const s = state();
  return {
    schemaVersion: 1,
    source: "web/index.html 2d-fit doctor refinement",
    generatedAt: new Date().toISOString(),
    imageSize: { width: els.canvas.width, height: els.canvas.height },
    mirroredView: renderState.mirror,
    system: renderState.system,
    symmetry: {
      enabled: Boolean(s.symmetry),
      axisX: Math.round(faceAxisX() * 100) / 100,
    },
    lines: (s.lines || []).filter((line) => !line.hidden).map((line) => ({
      name: line.name,
      region: line.region || "",
      symmetryRole: line.symmetryRole || "",
      symmetryPairId: line.symmetryPairId || "",
      points: line.pts.map((point) => [Math.round(point[0] * 100) / 100, Math.round(point[1] * 100) / 100]),
    })),
    hiddenLines: (s.lines || []).filter((line) => line.hidden).map((line) => line.name),
  };
}
