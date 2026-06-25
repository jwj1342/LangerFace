// 2D 渲染：线条叠加、细节放大窗、统计面板。
import { SOLID, BAND, ZOOM_REGIONS } from "./constants.js";
import { ctx, els } from "./dom.js";
import { innerMouthTriangles, mapAtlas, pointInHandMasks, visibleRuns, visibleTriangles } from "./geometry.js";
import { mapSurfaceRefs } from "./incision_overlay.js";
import { modelState, renderState, sourceState } from "./state.js";
import { setLive } from "./ui.js";

const focusScratch = document.createElement("canvas");
const focusCtx = focusScratch.getContext("2d");
const focusZoomRange = { min: 1, max: 4.5 };
const INCISION_ZOOM_REGION = { kind: "incision_overlay" };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function faceBBox(lm) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of lm) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

export function draw(lm, W, H, masks = []) {
  const atlas = modelState.atlases[renderState.system];
  const vis = renderState.clip ? visibleTriangles(lm, modelState.triangles, modelState.noseTris) : null;
  const innerMouth = innerMouthTriangles(modelState.triangles); // 口裂三角面（张嘴会落进口内/牙齿），永久排除
  const mapped = mapAtlas(atlas, lm, modelState.triangles);
  const bb = faceBBox(lm);
  const stride = Math.max(1, Math.round(100 / (renderState.densityFrac * 100)));
  const hasMasks = masks.length > 0;

  ctx.save();
  ctx.globalAlpha = renderState.opacity; ctx.lineWidth = Math.max(1, W / 1300);
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  let count = 0;
  for (let li = 0; li < mapped.length; li++) {
    if (li % stride !== 0) continue;
    const ln = mapped[li];
    if (renderState.bands) {
      let my = 0; for (const p of ln.pts) my += p[1]; my = (my / ln.pts.length - bb.y0) / (bb.h || 1);
      ctx.strokeStyle = my < 0.36 ? BAND.top : my < 0.66 ? BAND.mid : BAND.low;
    } else ctx.strokeStyle = SOLID[renderState.system];
    // 每点可见性 = 朝向相机(背面剔除) 且 不属于口裂三角面 且 不在前方手部凸包内
    const mask = ln.pts.map((p, i) => {
      const v = vis ? vis[ln.tris[i]] : 1;
      if (innerMouth.has(ln.tris[i])) return 0; // 口裂三角面无论朝向都排除（#38）
      return v && !(hasMasks && pointInHandMasks(p, masks)) ? 1 : 0;
    });
    for (const run of visibleRuns(ln.pts, mask)) {
      ctx.beginPath(); ctx.moveTo(run[0][0], run[0][1]);
      for (let i = 1; i < run.length; i++) ctx.lineTo(run[i][0], run[i][1]);
      ctx.stroke();
    }
    count++;
  }
  if (renderState.meshPts) {
    ctx.globalAlpha = Math.min(1, renderState.opacity); ctx.fillStyle = "rgba(255,255,255,.55)";
    for (let i = 0; i < lm.length; i += 2) {
      if (hasMasks && pointInHandMasks(lm[i], masks)) continue;
      ctx.beginPath(); ctx.arc(lm[i][0], lm[i][1], Math.max(1, W / 1100), 0, 6.283); ctx.fill();
    }
  }
  drawIncisionOverlay(lm, W, masks, vis, innerMouth);
  ctx.restore();
  return count;
}

function overlayMask(mapped, masks, vis, innerMouth) {
  const hasMasks = masks.length > 0;
  return mapped.pts.map((p, i) => {
    const tri = mapped.tris[i];
    const front = vis ? vis[tri] : 1;
    if (innerMouth.has(tri)) return 0;
    return front && !(hasMasks && pointInHandMasks(p, masks)) ? 1 : 0;
  });
}

function strokeOverlayRefs(refs, lm, masks, vis, innerMouth, style) {
  const mapped = mapSurfaceRefs(refs, lm, modelState.triangles);
  if (mapped.pts.length < 2) return;
  const mask = overlayMask(mapped, masks, vis, innerMouth);
  ctx.strokeStyle = style.color;
  ctx.lineWidth = style.lineWidth;
  ctx.setLineDash(style.dash || []);
  for (const run of visibleRuns(mapped.pts, mask)) {
    ctx.beginPath();
    ctx.moveTo(run[0][0], run[0][1]);
    for (let i = 1; i < run.length; i++) ctx.lineTo(run[i][0], run[i][1]);
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function drawIncisionOverlay(lm, W, masks, vis, innerMouth) {
  const overlay = renderState.incisionOverlay;
  if (!overlay) return;
  ctx.save();
  ctx.globalAlpha = 0.98;
  const baseWidth = Math.max(2, W / 520);
  strokeOverlayRefs(overlay.tumor?.boundary_refs || [], lm, masks, vis, innerMouth, {
    color: "#facc15",
    lineWidth: baseWidth,
    dash: [baseWidth * 3, baseWidth * 2],
  });
  strokeOverlayRefs(overlay.candidate?.polyline_refs || [], lm, masks, vis, innerMouth, {
    color: overlay.candidate_type === "linear" ? "#22c55e" : "#5eead4",
    lineWidth: baseWidth * 1.35,
  });
  const center = mapSurfaceRefs([overlay.tumor?.center_ref], lm, modelState.triangles).pts[0];
  if (center && !(masks.length && pointInHandMasks(center, masks))) {
    ctx.fillStyle = "#facc15";
    ctx.strokeStyle = "#111820";
    ctx.lineWidth = Math.max(1, W / 900);
    ctx.beginPath();
    ctx.arc(center[0], center[1], Math.max(4, W / 180), 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

// ── 细节放大窗 ────────────────────────────────────────────────────────────────
export function buildZoomCards(onSelect = () => {}) {
  els.zoomStrip.innerHTML = "";
  const zoomItems = [
    { label: "全脸", region: null },
    ...(renderState.incisionOverlay ? [{ label: "切口候选", region: INCISION_ZOOM_REGION }] : []),
    ...ZOOM_REGIONS.map((region) => ({ label: region.label, region })),
  ];
  renderState.zoomCards = zoomItems.map((item) => {
    const card = document.createElement("div"); card.className = "zoom-card";
    card.tabIndex = 0;
    const cv = document.createElement("canvas"); cv.width = 300; cv.height = 300;
    if (renderState.mirror) cv.classList.add("mirror");
    const tag = document.createElement("div"); tag.className = "tag"; tag.textContent = item.label;
    card.appendChild(cv); card.appendChild(tag); els.zoomStrip.appendChild(card);
    const select = () => {
      const nextRegion = item.region && renderState.focusRegion !== item.region ? item.region : null;
      setFocusRegion(nextRegion);
      onSelect();
    };
    card.addEventListener("click", select);
    card.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      select();
    });
    return { region: item.region, card, canvas: cv, ctx: cv.getContext("2d") };
  });
  syncFocusCards();
}

export function setFocusRegion(region) {
  renderState.focusRegion = region;
  syncFocusCards();
}

export function adjustFocusZoom(deltaY) {
  if (!renderState.focusRegion) return false;
  const delta = clamp(deltaY || 0, -120, 120);
  renderState.focusZoom = clamp(renderState.focusZoom * Math.exp(-delta * 0.0018), focusZoomRange.min, focusZoomRange.max);
  return true;
}

function syncFocusCards() {
  renderState.zoomCards.forEach((zc) => zc.card.classList.toggle("active", zc.region === renderState.focusRegion));
}

export function clearZooms() {
  for (const zc of renderState.zoomCards) { zc.ctx.fillStyle = "#05070a"; zc.ctx.fillRect(0, 0, zc.canvas.width, zc.canvas.height); }
}

// 从已叠加线条的主画布上裁剪关键区域并放大到各窗口（线条随之放大显示）
export function drawZooms(lm, W) {
  if (!renderState.zoom || !renderState.zoomCards.length) return;
  const faceW = faceBBox(lm).w || W;
  for (const zc of renderState.zoomCards) {
    const g = zc.ctx, dw = zc.canvas.width, dh = zc.canvas.height;
    g.fillStyle = "#05070a"; g.fillRect(0, 0, dw, dh);
    if (!zc.region) {
      drawFullFrameCard(g, dw, dh, W, els.canvas.height);
      continue;
    }
    const box = zoomRegionBounds(lm, zc.region);
    if (!box) continue;
    const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
    let s = Math.max(box.w, box.h) * 1.7;
    s = Math.max(s, faceW * 0.13);   // 避免过度放大、保留一点周边
    g.drawImage(els.canvas, cx - s / 2, cy - s / 2, s, s, 0, 0, dw, dh);
  }
  syncFocusCards();
}

function drawFullFrameCard(g, dw, dh, W, H) {
  const scale = Math.min(dw / W, dh / H);
  const tw = W * scale;
  const th = H * scale;
  g.drawImage(els.canvas, 0, 0, W, H, (dw - tw) / 2, (dh - th) / 2, tw, th);
}

function boundsFromPoints(points) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of points || []) {
    if (!p) continue;
    x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
  }
  if (x1 < x0) return null;
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

function regionBounds(lm, region) {
  const pts = [];
  for (const i of region.idx) {
    const p = lm[i]; if (!p) continue;
    pts.push(p);
  }
  return boundsFromPoints(pts);
}

function incisionOverlayBounds(lm) {
  const overlay = renderState.incisionOverlay;
  if (!overlay) return null;
  const refs = [
    overlay.tumor?.center_ref,
    ...(overlay.tumor?.boundary_refs || []),
    ...(overlay.candidate?.polyline_refs || []),
  ].filter(Boolean);
  if (!refs.length) return null;
  return boundsFromPoints(mapSurfaceRefs(refs, lm, modelState.triangles).pts);
}

function zoomRegionBounds(lm, region) {
  if (region?.kind === "incision_overlay") return incisionOverlayBounds(lm);
  return regionBounds(lm, region);
}

export function drawFocusedRegion(lm, W, H) {
  if (!renderState.focusRegion || !lm) return;
  const crop = focusCropRect(lm, renderState.focusRegion, W, H);
  if (!crop) return;

  focusScratch.width = W;
  focusScratch.height = H;
  focusCtx.drawImage(els.canvas, 0, 0);
  ctx.drawImage(focusScratch, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, W, H);
}

function focusCropRect(lm, region, W, H) {
  const box = zoomRegionBounds(lm, region);
  if (!box) return null;
  const faceW = faceBBox(lm).w || W;
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const zoom = clamp(renderState.focusZoom || 1.8, focusZoomRange.min, focusZoomRange.max);
  let sw = Math.max(box.w * 2.5, faceW * 0.42) / zoom;
  let sh = sw * (H / W);
  if (sh < box.h * 2.2) { sh = box.h * 2.2; sw = sh * (W / H); }
  sw = Math.min(W, sw); sh = Math.min(H, sh);
  return {
    sx: clamp(cx - sw / 2, 0, W - sw),
    sy: clamp(cy - sh / 2, 0, H - sh),
    sw,
    sh,
  };
}

// ── 统计 ──────────────────────────────────────────────────────────────────────
export function updateStats(lm, W, H, lineCount) {
  const q = Math.round(sourceState.presence * 100);
  const label = q >= 85 ? "稳定" : q >= 45 ? "一般" : q > 0 ? "寻找中" : "未开始";
  els.qualityVal.textContent = `${label} ${q}%`; els.qualityBar.style.width = q + "%";
  if (!lm || sourceState.presence <= 0) {
    els.statState.textContent = sourceState.running ? "搜索中" : "未开始";
    els.statFace.textContent = els.statYaw.textContent = els.statLines.textContent = "—";
    setLive(sourceState.running && sourceState.sourceKind === "camera", sourceState.running ? els.live.dataset.k || "运行中" : "待机");
    return;
  }
  els.statState.textContent = sourceState.presence > 0.85 ? "稳定" : "搜索中";
  const bb = faceBBox(lm);
  els.statFace.textContent = Math.round(100 * (bb.w * bb.h) / (W * H)) + "%";
  // 偏航估计：鼻尖相对两颊中点的水平偏移 / 脸宽
  const nose = lm[1], cheekL = lm[234], cheekR = lm[454];
  const cx = (cheekL[0] + cheekR[0]) / 2, fw = Math.abs(cheekR[0] - cheekL[0]) || 1;
  els.statYaw.textContent = ((nose[0] - cx) / fw).toFixed(2);
  els.statLines.textContent = lineCount;
}
