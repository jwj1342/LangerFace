// @ts-nocheck -- DOM runtime typing is tracked by #95.
import { V6_DEMO_RESULTS, V6_VIEW_LABELS } from "./v6DemoManifest.ts";
import { displacementSamples, resultExtent, validateV6Result } from "./v6ReviewModel.ts";

const $ = (id) => document.getElementById(id);
function collectElements() {
  return {
  subjectTabs: $("subjectTabs"),
  viewTabs: $("viewTabs"),
  exampleImage: $("exampleImage"),
  exampleMetrics: $("exampleMetrics"),
  dropZone: $("dropZone"),
  fileInput: $("fileInput"),
  showPrior: $("showPrior"),
  showFinal: $("showFinal"),
  showMask: $("showMask"),
  showArrows: $("showArrows"),
  backgroundOpacity: $("backgroundOpacity"),
  reviewStatus: $("reviewStatus"),
  reviewMetrics: $("reviewMetrics"),
  exportButton: $("exportButton"),
  reviewCanvas: $("reviewCanvas"),
  canvasTitle: $("canvasTitle"),
  };
}
const els = collectElements();
let uiAbortController = null;

const state = {
  subjectIndex: 0,
  view: "compare",
  payload: null,
  report: null,
  background: null,
  mask: null,
  maskTint: null,
  fileLabel: "",
};

function buttonTab(label, selected, onClick) {
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
  els.viewTabs.replaceChildren(...Object.entries(V6_VIEW_LABELS).map(([key, label]) => buttonTab(
    label,
    key === state.view,
    () => { state.view = key; renderExampleNavigation(); renderExample(); },
  )));
}

function metricCard(label, value, detail = "", tone = "") {
  return `<div class="metric"><span class="metric-label">${label}</span><span class="metric-value ${tone}">${value}</span>${detail ? `<small>${detail}</small>` : ""}</div>`;
}

function renderExample() {
  const entry = V6_DEMO_RESULTS[state.subjectIndex];
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

async function decodeImage(file) {
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

function imageSize(image) {
  return { width: image?.width || image?.naturalWidth || 0, height: image?.height || image?.naturalHeight || 0 };
}

function buildMaskTint(mask, width, height) {
  const sourceSize = imageSize(mask);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
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

function strokePolyline(context, points, color, width) {
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

function drawArrow(context, start, end, color, lineWidth) {
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

function miniMetric(label, value) {
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

async function loadFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  const jsonCandidates = [];
  for (const file of files.filter((entry) => entry.name.toLowerCase().endsWith(".json"))) {
    try {
      const payload = JSON.parse(await file.text());
      if (Array.isArray(payload?.lines) && payload.lines.some((line) => Array.isArray(line?.points_xy))) {
        jsonCandidates.push({ file, payload });
      }
    } catch (error) {
      console.warn(`无法读取 ${file.name}`, error);
    }
  }
  if (jsonCandidates.length) {
    const preferred = jsonCandidates.find(({ file }) => file.name.toLowerCase() === "personalized_rstl.json") || jsonCandidates[0];
    state.payload = preferred.payload;
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

export function mountV6Review() {
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
  const options = { signal: uiAbortController.signal };

  els.fileInput.addEventListener("change", () => loadFiles(els.fileInput.files), options);
  for (const eventName of ["dragenter", "dragover"]) {
    els.dropZone.addEventListener(eventName, (event) => { event.preventDefault(); els.dropZone.classList.add("dragging"); }, options);
  }
  for (const eventName of ["dragleave", "drop"]) {
    els.dropZone.addEventListener(eventName, (event) => { event.preventDefault(); els.dropZone.classList.remove("dragging"); }, options);
  }
  els.dropZone.addEventListener("drop", (event) => loadFiles(event.dataTransfer.files), options);
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

export function disposeV6Review() {
  uiAbortController?.abort();
  uiAbortController = null;
  state.background?.close?.();
  state.mask?.close?.();
}
