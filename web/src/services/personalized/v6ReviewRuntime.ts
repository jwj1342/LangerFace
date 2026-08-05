import {
  V6_DEMO_RESULTS,
  V6_VIEW_LABELS,
  type V6DemoView,
} from "./v6DemoManifest.ts";
import {
  displacementSamples,
  resultExtent,
  validateV6Result,
  type V6Point,
  type V6ResultPayload,
  type V6ValidationResult,
} from "./v6ReviewModel.ts";

type DecodedImage = ImageBitmap | HTMLImageElement;

interface V6ReviewElements {
  subjectTabs: HTMLElement;
  viewTabs: HTMLElement;
  exampleImage: HTMLImageElement;
  exampleMetrics: HTMLElement;
  dropZone: HTMLElement;
  fileInput: HTMLInputElement;
  showPrior: HTMLInputElement;
  showFinal: HTMLInputElement;
  showMask: HTMLInputElement;
  showArrows: HTMLInputElement;
  backgroundOpacity: HTMLInputElement;
  reviewStatus: HTMLElement;
  reviewMetrics: HTMLElement;
  exportButton: HTMLButtonElement;
  reviewCanvas: HTMLCanvasElement;
  canvasTitle: HTMLElement;
}

interface V6ReviewState {
  subjectIndex: number;
  view: V6DemoView;
  payload: V6ResultPayload | null;
  report: V6ValidationResult | null;
  background: DecodedImage | null;
  mask: DecodedImage | null;
  maskTint: HTMLCanvasElement | null;
  fileLabel: string;
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`V6 review element #${id} is missing`);
  return element as T;
}

function collectElements(): V6ReviewElements {
  return {
    subjectTabs: requiredElement("subjectTabs"),
    viewTabs: requiredElement("viewTabs"),
    exampleImage: requiredElement<HTMLImageElement>("exampleImage"),
    exampleMetrics: requiredElement("exampleMetrics"),
    dropZone: requiredElement("dropZone"),
    fileInput: requiredElement<HTMLInputElement>("fileInput"),
    showPrior: requiredElement<HTMLInputElement>("showPrior"),
    showFinal: requiredElement<HTMLInputElement>("showFinal"),
    showMask: requiredElement<HTMLInputElement>("showMask"),
    showArrows: requiredElement<HTMLInputElement>("showArrows"),
    backgroundOpacity: requiredElement<HTMLInputElement>("backgroundOpacity"),
    reviewStatus: requiredElement("reviewStatus"),
    reviewMetrics: requiredElement("reviewMetrics"),
    exportButton: requiredElement<HTMLButtonElement>("exportButton"),
    reviewCanvas: requiredElement<HTMLCanvasElement>("reviewCanvas"),
    canvasTitle: requiredElement("canvasTitle"),
  };
}
const els = collectElements();
let uiAbortController: AbortController | null = null;

const state: V6ReviewState = {
  subjectIndex: 0,
  view: "compare",
  payload: null,
  report: null,
  background: null,
  mask: null,
  maskTint: null,
  fileLabel: "",
};

function buttonTab(label: string, selected: boolean, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tab";
  button.role = "tab";
  button.setAttribute("aria-selected", String(selected));
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function renderExampleNavigation() {
  els.subjectTabs.replaceChildren(...V6_DEMO_RESULTS.map((entry, index) => buttonTab(
    `ID ${entry.id}`,
    index === state.subjectIndex,
    () => { state.subjectIndex = index; renderExampleNavigation(); renderExample(); },
  )));
  const viewEntries = Object.entries(V6_VIEW_LABELS) as Array<[V6DemoView, string]>;
  els.viewTabs.replaceChildren(...viewEntries.map(([key, label]) => buttonTab(
    label,
    key === state.view,
    () => { state.view = key; renderExampleNavigation(); renderExample(); },
  )));
}

function metricCard(label: string, value: string, detail = "", tone = ""): string {
  return `<div class="metric"><span class="metric-label">${label}</span><span class="metric-value ${tone}">${value}</span>${detail ? `<small>${detail}</small>` : ""}</div>`;
}

function renderExample() {
  const entry = V6_DEMO_RESULTS[state.subjectIndex];
  if (!entry) return;
  els.exampleImage.src = entry.images[state.view];
  els.exampleImage.alt = `ID ${entry.id} · ${V6_VIEW_LABELS[state.view]}`;
  const metric = entry.metrics;
  els.exampleMetrics.innerHTML = [
    metricCard("拓扑检查", "通过", "216 条曲线，点数与顺序不变", "status-good"),
    metricCard("移动曲线 / 点", `${metric.movedCurves} / ${metric.movedPoints}`, "仅皱纹证据支持的局部区间"),
    metricCard("区间 P90", `${metric.p90After.toFixed(2)} px`, `限制前 ${metric.p90Before.toFixed(2)} px · 上限 ${metric.p90Limit.toFixed(2)} px`),
    metricCard("软连接距离", `${metric.softLink.toFixed(2)} px`, "0.013 × face width"),
    metricCard("匹配距离改善", `${metric.distanceGain >= 0 ? "+" : ""}${metric.distanceGain.toFixed(2)} px`, "微调前到皱纹中心线的距离下降"),
    metricCard("方向改善", `${metric.directionGain >= 0 ? "+" : ""}${metric.directionGain.toFixed(2)}°`, "负值表示该例平均方向略有退化"),
  ].join("");
}

async function decodeImage(file: File): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function imageSize(image: DecodedImage | null): { width: number; height: number } {
  if (!image) return { width: 0, height: 0 };
  if (image instanceof HTMLImageElement) {
    return { width: image.naturalWidth || image.width, height: image.naturalHeight || image.height };
  }
  return { width: image.width, height: image.height };
}

function buildMaskTint(mask: DecodedImage, width: number, height: number): HTMLCanvasElement {
  const sourceSize = imageSize(mask);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("2D canvas context is unavailable");
  context.drawImage(mask, 0, 0, sourceSize.width, sourceSize.height, 0, 0, width, height);
  const image = context.getImageData(0, 0, width, height);
  for (let index = 0; index < image.data.length; index += 4) {
    const luminance = Math.max(image.data[index], image.data[index + 1], image.data[index + 2]);
    if (luminance < 20) {
      image.data[index + 3] = 0;
      continue;
    }
    image.data[index] = 30;
    image.data[index + 1] = 255;
    image.data[index + 2] = 151;
    image.data[index + 3] = Math.min(220, Math.max(60, luminance));
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

function strokePolyline(
  context: CanvasRenderingContext2D,
  points: readonly V6Point[],
  color: string,
  width: number,
): void {
  if (!Array.isArray(points) || points.length < 2) return;
  context.beginPath();
  context.strokeStyle = color;
  context.lineWidth = width;
  context.lineJoin = "round";
  context.lineCap = "round";
  points.forEach((point, index) => {
    if (index === 0) context.moveTo(point[0], point[1]);
    else context.lineTo(point[0], point[1]);
  });
  context.stroke();
}

function drawArrow(
  context: CanvasRenderingContext2D,
  start: V6Point,
  end: V6Point,
  color: string,
  lineWidth: number,
): void {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (length < 0.2) return;
  const angle = Math.atan2(dy, dx);
  const head = Math.max(2.2, Math.min(5, length * 0.7));
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.beginPath();
  context.moveTo(start[0], start[1]);
  context.lineTo(end[0], end[1]);
  context.lineTo(end[0] - head * Math.cos(angle - Math.PI / 5), end[1] - head * Math.sin(angle - Math.PI / 5));
  context.moveTo(end[0], end[1]);
  context.lineTo(end[0] - head * Math.cos(angle + Math.PI / 5), end[1] - head * Math.sin(angle + Math.PI / 5));
  context.stroke();
}

function renderReview() {
  const canvas = els.reviewCanvas;
  const context = canvas.getContext("2d");
  if (!context) return;
  const extent = resultExtent(state.report?.lines || []);
  const backgroundSize = imageSize(state.background);
  const maskSize = imageSize(state.mask);
  const width = Math.max(768, extent.width, backgroundSize.width, maskSize.width);
  const height = Math.max(768, extent.height, backgroundSize.height, maskSize.height);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
    state.maskTint = null;
  }

  const gradient = context.createRadialGradient(width * .5, height * .43, 10, width * .5, height * .5, width * .65);
  gradient.addColorStop(0, "#171d22");
  gradient.addColorStop(1, "#050608");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);
  if (state.background) {
    context.save();
    context.globalAlpha = Number(els.backgroundOpacity.value) / 100;
    context.drawImage(state.background, 0, 0, backgroundSize.width, backgroundSize.height, 0, 0, width, height);
    context.restore();
  }

  if (state.mask && els.showMask.checked) {
    if (!state.maskTint) state.maskTint = buildMaskTint(state.mask, width, height);
    context.save();
    context.globalAlpha = .72;
    context.drawImage(state.maskTint, 0, 0);
    context.restore();
  }

  const scale = Math.max(width, height) / 768;
  if (state.report?.lines) {
    if (els.showPrior.checked) {
      for (const line of state.report.lines) strokePolyline(context, line.points_prior_xy, "rgba(158,168,184,.72)", 1.05 * scale);
    }
    if (els.showFinal.checked) {
      for (const line of state.report.lines) strokePolyline(context, line.points_xy, "rgba(255,79,216,.94)", 1.45 * scale);
    }
    if (els.showArrows.checked) {
      for (const line of state.report.lines) {
        for (const sample of displacementSamples(line)) drawArrow(context, sample.prior, sample.final, "rgba(67,217,255,.92)", .9 * scale);
      }
    }
  }
}

function miniMetric(label: string, value: string | number): string {
  return `<div class="mini-metric"><b>${value}</b><span>${label}</span></div>`;
}

function updateReviewPanel() {
  if (!state.report) {
    els.reviewStatus.className = "review-status";
    els.reviewStatus.textContent = "尚未加载 V6 结果。";
    els.reviewMetrics.hidden = true;
    els.exportButton.disabled = true;
    renderReview();
    return;
  }
  const report = state.report;
  const lines = [
    `${state.fileLabel || "V6 JSON"}`,
    report.ok ? "拓扑与数据结构检查通过。" : `检查未通过：${report.errors.join("；")}`,
  ];
  if (report.warnings.length) lines.push(`提示：${report.warnings.join("；")}`);
  els.reviewStatus.className = `review-status ${report.ok ? "good" : "error"}`;
  els.reviewStatus.textContent = lines.join("\n");
  const metric = report.metrics;
  els.reviewMetrics.innerHTML = [
    miniMetric("曲线", metric.curveCount),
    miniMetric("总点数", metric.pointCount),
    miniMetric("移动曲线", metric.movedCurveCount),
    miniMetric("移动点", metric.movedPointCount),
    miniMetric("P90 位移", `${metric.p90Px.toFixed(2)} px`),
    miniMetric("最大位移", `${metric.maxPx.toFixed(2)} px`),
  ].join("");
  els.reviewMetrics.hidden = false;
  els.exportButton.disabled = !report.ok;
  els.canvasTitle.textContent = `${state.fileLabel || "V6 结果"} · 微调前后叠加`;
  renderReview();
}

async function loadFiles(fileList: FileList | readonly File[] | null): Promise<void> {
  if (!fileList) return;
  const files = [...fileList];
  if (!files.length) return;
  const jsonCandidates: Array<{ file: File; payload: unknown }> = [];
  for (const file of files.filter((entry) => entry.name.toLowerCase().endsWith(".json"))) {
    try {
      const payload: unknown = JSON.parse(await file.text());
      if (typeof payload === "object" && payload !== null && "lines" in payload
          && Array.isArray(payload.lines)
          && payload.lines.some((line) => (
            typeof line === "object" && line !== null && "points_xy" in line
            && Array.isArray(line.points_xy)
          ))) {
        jsonCandidates.push({ file, payload });
      }
    } catch (error) {
      console.warn(`无法读取 ${file.name}`, error);
    }
  }
  if (jsonCandidates.length) {
    const preferred = jsonCandidates.find(({ file }) => file.name.toLowerCase() === "personalized_rstl.json")
      || jsonCandidates[0];
    if (!preferred) return;
    state.payload = preferred.payload as V6ResultPayload;
    state.report = validateV6Result(preferred.payload);
    state.fileLabel = preferred.file.name;
  }

  const images = files.filter((entry) => entry.type.startsWith("image/"));
  const maskFile = images.find((entry) => /wrinkle.*(mask|skeleton)|skeleton.*wrinkle/i.test(entry.name));
  const backgroundFile = images.find((entry) => entry !== maskFile && /(neutral|reference|source)/i.test(entry.name))
    || images.find((entry) => entry !== maskFile);
  if (backgroundFile) state.background = await decodeImage(backgroundFile);
  if (maskFile) {
    state.mask = await decodeImage(maskFile);
    state.maskTint = null;
  }

  if (!state.report) {
    els.reviewStatus.className = "review-status error";
    els.reviewStatus.textContent = "未找到包含 points_prior_xy 与 points_xy 的 V6 personalized_rstl.json。";
  }
  updateReviewPanel();
}

export function mountV6Review(): void {
  uiAbortController?.abort();
  Object.assign(els, collectElements());
  Object.assign(state, {
    subjectIndex: 0,
    view: "compare",
    payload: null,
    report: null,
    background: null,
    mask: null,
    maskTint: null,
    fileLabel: "",
  });
  uiAbortController = new AbortController();
  const options: AddEventListenerOptions = { signal: uiAbortController.signal };

  els.fileInput.addEventListener("change", () => loadFiles(els.fileInput.files), options);
  for (const eventName of ["dragenter", "dragover"]) {
    els.dropZone.addEventListener(eventName, (event) => { event.preventDefault(); els.dropZone.classList.add("dragging"); }, options);
  }
  for (const eventName of ["dragleave", "drop"]) {
    els.dropZone.addEventListener(eventName, (event) => { event.preventDefault(); els.dropZone.classList.remove("dragging"); }, options);
  }
  els.dropZone.addEventListener("drop", (event) => {
    if (event instanceof DragEvent) void loadFiles(event.dataTransfer?.files ?? null);
  }, options);
  for (const input of [els.showPrior, els.showFinal, els.showMask, els.showArrows, els.backgroundOpacity]) {
    input.addEventListener("input", renderReview, options);
  }
  els.exportButton.addEventListener("click", () => {
    renderReview();
    els.reviewCanvas.toBlob((blob) => {
      if (!blob) return;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `rstl_v6_review_${new Date().toISOString().slice(0, 10)}.png`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }, "image/png");
  }, options);

  renderExampleNavigation();
  renderExample();
  updateReviewPanel();
}

export function disposeV6Review(): void {
  uiAbortController?.abort();
  uiAbortController = null;
  if (state.background instanceof ImageBitmap) state.background.close();
  if (state.mask instanceof ImageBitmap) state.mask.close();
}
