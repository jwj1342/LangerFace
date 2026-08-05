import { els } from "./liveDom.ts";
import type { MappedAtlasLine } from "./geometryAtlas.ts";
import type { Vec3 } from "./softBody";
import {
  applyCurveRefinementTransport,
  buildCurveRefinementTransport,
  curveEraseTargets,
  deformCurveWide,
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
  const y = (event.clientY - rect.top) * els.canvas.height / Math.max(1, rect.height);
  if (renderState.mirror) x = els.canvas.width - x;
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
  s.latestAutoLines = cloneLines(mapped);
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
  updateRefineUi();
  return true;
}

export function selectedLineIndex(): number | null {
  return state().selected?.lineIndex ?? null;
}

export function selectedPointIndex(): number | null {
  return state().selected?.pointIndex ?? null;
}

export function isRefineActive(): boolean {
  return state().active;
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
  s.symmetry = true;
  s.showAxis = true;
  s.lines = null;
  s.latestAutoLines = null;
  s.liveTransport = null;
  s.selected = null;
  s.dirty = false;
  s.undoStack = [];
  s.drag = null;
  updateRefineUi();
  setRefineAvailability();
}

export function updateRefineUi(): void {
  const s = state();
  els.refine2d.setAttribute("aria-pressed", String(s.active));
  els.refine2d.textContent = s.active ? "退出 2D 微调" : "2D 结果微调";
  els.refine2dPanel.classList.toggle("hidden", !s.active);
  els.mainWrap.classList.toggle("refining", s.active);
  els.refine2dStatus.textContent = !s.active
    ? "未开始"
    : s.dirty ? "已修改" : "查看中";
  const modeButtons: Array<[HTMLButtonElement, RefineMode]> = [
    [els.refineView, "view"],
    [els.refineDrag, "drag"],
    [els.refineErase, "erase"],
  ];
  for (const [button, mode] of modeButtons) {
    button.setAttribute("aria-pressed", String(s.mode === mode));
  }
  els.refineUndo.disabled = !s.undoStack.length;
  els.refineExport.disabled = !s.active || !s.lines?.length;
  els.refineReset.disabled = !s.active || !s.latestAutoLines?.length;
  els.refineSymmetry.checked = s.symmetry;
  els.refineAxis.checked = s.showAxis;
}

export function toggleRefine2d(): void {
  const s = state();
  if (s.active) {
    s.active = false;
    s.selected = null;
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
  s.mode = "view";
  s.lines = s.lines || cloneLines(s.latestAutoLines);
  s.selected = null;
  els.refine2dHint.textContent = `${sourceLabel()}结果已进入微调：先点选线，切到“拖点”后再修改。`;
  updateRefineUi();
  requestRefineFrame();
}

export function setRefineMode(mode: RefineMode): void {
  state().mode = mode;
  els.refine2dHint.textContent = {
    view: "查看模式只允许点选线，避免误改。",
    drag: "拖动曲线上任意位置，整条线会按弧长平滑联动。",
    erase: "点击不需要的曲线即可隐藏整条线；可用“撤销”恢复。",
  }[mode] || "";
  updateRefineUi();
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
  const maxPx = Math.max(10, els.canvas.width / 90);
  return nearestPoint(s.lines || [], point, maxPx) || nearestSegmentLine(s.lines || [], point, maxPx);
}

function movePoint(pick: RefinePick, target: readonly [number, number]): void {
  const s = state();
  const line = s.lines?.[pick.lineIndex];
  if (!line) return;
  const original = s.drag?.original || line.pts.map((point) => [...point]);
  line.pts = deformCurveWide(original, pick.pointIndex, target, {
    width: els.canvas.width,
    height: els.canvas.height,
  }).map((point) => [point[0], point[1], point[2] || 0]);
}

function lineCentroid(line: EditableRefineLine | null | undefined): [number, number] {
  const pts = line?.pts || [];
  if (!pts.length) return [0, 0];
  const sum = pts.reduce<[number, number]>(
    (acc, point) => [acc[0] + point[0], acc[1] + point[1]],
    [0, 0],
  );
  return [sum[0] / pts.length, sum[1] / pts.length];
}

function mirroredName(name = ""): string {
  if (name.includes("_left_")) return name.replace("_left_", "_right_");
  if (name.includes("_right_")) return name.replace("_right_", "_left_");
  if (name.endsWith("_l")) return `${name.slice(0, -2)}_r`;
  if (name.endsWith("_r")) return `${name.slice(0, -2)}_l`;
  if (name.includes("left")) return name.replace("left", "right");
  if (name.includes("right")) return name.replace("right", "left");
  return "";
}

function findSymmetryPartner(lineIndex: number): number | null {
  const s = state();
  const lines = s.lines;
  const line = lines?.[lineIndex];
  if (!line || line.hidden) return null;
  if (line.symmetryRole === "midline" || line.symmetryRole === "bilateral") return null;
  if (line.symmetryPairId) {
    const explicit = lines.findIndex((candidate, index) =>
      index !== lineIndex && !candidate.hidden && candidate.symmetryPairId === line.symmetryPairId);
    if (explicit >= 0) return explicit;
  }
  const name = mirroredName(line.name);
  if (name) {
    const byName = lines.findIndex((candidate, index) =>
      index !== lineIndex && !candidate.hidden && candidate.name === name);
    if (byName >= 0) return byName;
  }

  const axis = faceAxisX();
  const source = lineCentroid(line);
  const mirrored: [number, number] = [2 * axis - source[0], source[1]];
  let best: { index: number; score: number } | null = null;
  for (let index = 0; index < lines.length; index++) {
    const candidate = lines[index];
    if (!candidate || index === lineIndex || candidate.hidden) continue;
    if (line.region && candidate.region && line.region !== candidate.region) continue;
    const c = lineCentroid(candidate);
    if ((source[0] - axis) * (c[0] - axis) > 0) continue;
    const centroidScore = Math.hypot(c[0] - mirrored[0], c[1] - mirrored[1]);
    const countScore = Math.abs((candidate.pts?.length || 0) - (line.pts?.length || 0)) * 0.6;
    const score = centroidScore + countScore;
    if (!best || score < best.score) best = { index, score };
  }
  return best && best.score < els.canvas.width * 0.16 ? best.index : null;
}

export function symmetryPartnerIndex(): number | null {
  const s = state();
  if (!s.active || !s.symmetry || s.selected?.lineIndex == null) return null;
  return findSymmetryPartner(s.selected.lineIndex);
}

function mirroredPoints(
  points: readonly RefinePoint[],
  axis: number,
  reference: readonly RefinePoint[] | null = null,
): Vec3[] {
  const next: Vec3[] = points.map((point) => [2 * axis - point[0], point[1], point[2] || 0]);
  if (!reference?.length || reference.length !== next.length) return next;
  const direct = next.reduce((sum, point, index) =>
    sum + Math.hypot(point[0] - reference[index][0], point[1] - reference[index][1]), 0);
  const reverse = next.reduce((sum, point, index) =>
    sum + Math.hypot(point[0] - reference[reference.length - 1 - index][0], point[1] - reference[reference.length - 1 - index][1]), 0);
  return reverse < direct ? next.reverse() : next;
}

function syncSymmetryForLine(lineIndex: number): number | null {
  const s = state();
  if (!s.symmetry) return null;
  const lines = s.lines;
  const source = lines?.[lineIndex];
  const partnerIndex = findSymmetryPartner(lineIndex);
  const partner = partnerIndex == null ? null : lines?.[partnerIndex];
  if (!source || !partner) return null;
  partner.pts = mirroredPoints(source.pts, faceAxisX(), partner.pts);
  partner.tris = source.tris.length === partner.pts.length ? [...source.tris] : partner.tris;
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
  if (s.mode === "drag") {
    const line = s.lines[pick.lineIndex];
    if (!line) return false;
    captureHistory(`拖动 ${line.name}`);
    s.drag = {
      pointerId: event.pointerId,
      pick,
      original: line.pts.map((point) => [...point] as Vec3),
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
  movePoint(s.drag.pick, canvasPoint(event));
  syncSymmetryForLine(s.drag.pick.lineIndex);
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
  s.drag = null;
  if (els.canvas.hasPointerCapture(event.pointerId)) els.canvas.releasePointerCapture(event.pointerId);
  markDirty(line ? `${line.name} 已微调。` : "线条已微调。");
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
