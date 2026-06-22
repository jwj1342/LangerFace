// 2D 渲染：线条叠加、细节放大窗、统计面板。
import { SOLID, BAND, ZOOM_REGIONS } from "./constants.js";
import { ctx, els } from "./dom.js";
import { mapAtlas, pointInHandMasks, visibleRuns, visibleTriangles } from "./geometry.js";
import { S } from "./state.js";
import { setLive } from "./ui.js";

export function faceBBox(lm) {
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (const p of lm) { x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]); }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

export function draw(lm, W, H, masks = []) {
  const atlas = S.atlases[S.system];
  const vis = S.clip ? visibleTriangles(lm, S.triangles, S.noseTris) : null;
  const mapped = mapAtlas(atlas, lm, S.triangles);
  const bb = faceBBox(lm);
  const stride = Math.max(1, Math.round(100 / (S.densityFrac * 100)));
  const hasMasks = masks.length > 0;

  ctx.save();
  ctx.globalAlpha = S.opacity; ctx.lineWidth = Math.max(1, W / 1300);
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  let count = 0;
  for (let li = 0; li < mapped.length; li++) {
    if (li % stride !== 0) continue;
    const ln = mapped[li];
    if (S.bands) {
      let my = 0; for (const p of ln.pts) my += p[1]; my = (my / ln.pts.length - bb.y0) / (bb.h || 1);
      ctx.strokeStyle = my < 0.36 ? BAND.top : my < 0.66 ? BAND.mid : BAND.low;
    } else ctx.strokeStyle = SOLID[S.system];
    // 每点可见性 = 朝向相机(背面剔除) 且 不在前方手部凸包内
    const mask = ln.pts.map((p, i) => {
      const v = vis ? vis[ln.tris[i]] : 1;
      return v && !(hasMasks && pointInHandMasks(p, masks)) ? 1 : 0;
    });
    for (const run of visibleRuns(ln.pts, mask)) {
      ctx.beginPath(); ctx.moveTo(run[0][0], run[0][1]);
      for (let i = 1; i < run.length; i++) ctx.lineTo(run[i][0], run[i][1]);
      ctx.stroke();
    }
    count++;
  }
  if (S.meshPts) {
    ctx.globalAlpha = Math.min(1, S.opacity); ctx.fillStyle = "rgba(255,255,255,.55)";
    for (let i = 0; i < lm.length; i += 2) {
      if (hasMasks && pointInHandMasks(lm[i], masks)) continue;
      ctx.beginPath(); ctx.arc(lm[i][0], lm[i][1], Math.max(1, W / 1100), 0, 6.283); ctx.fill();
    }
  }
  ctx.restore();
  return count;
}

// ── 细节放大窗 ────────────────────────────────────────────────────────────────
export function buildZoomCards() {
  els.zoomStrip.innerHTML = "";
  S.zoomCards = ZOOM_REGIONS.map((r) => {
    const card = document.createElement("div"); card.className = "zoom-card";
    const cv = document.createElement("canvas"); cv.width = 300; cv.height = 300;
    if (S.mirror) cv.classList.add("mirror");
    const tag = document.createElement("div"); tag.className = "tag"; tag.textContent = r.label;
    card.appendChild(cv); card.appendChild(tag); els.zoomStrip.appendChild(card);
    return { region: r, canvas: cv, ctx: cv.getContext("2d") };
  });
}

export function clearZooms() {
  for (const zc of S.zoomCards) { zc.ctx.fillStyle = "#05070a"; zc.ctx.fillRect(0, 0, zc.canvas.width, zc.canvas.height); }
}

// 从已叠加线条的主画布上裁剪关键区域并放大到各窗口（线条随之放大显示）
export function drawZooms(lm, W) {
  if (!S.zoom || !S.zoomCards.length) return;
  const faceW = faceBBox(lm).w || W;
  for (const zc of S.zoomCards) {
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    for (const i of zc.region.idx) {
      const p = lm[i]; if (!p) continue;
      x0 = Math.min(x0, p[0]); y0 = Math.min(y0, p[1]); x1 = Math.max(x1, p[0]); y1 = Math.max(y1, p[1]);
    }
    if (x1 < x0) continue;
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    let s = Math.max(x1 - x0, y1 - y0) * 1.7;
    s = Math.max(s, faceW * 0.13);   // 避免过度放大、保留一点周边
    const g = zc.ctx, dw = zc.canvas.width, dh = zc.canvas.height;
    g.fillStyle = "#05070a"; g.fillRect(0, 0, dw, dh);
    g.drawImage(els.canvas, cx - s / 2, cy - s / 2, s, s, 0, 0, dw, dh);
  }
}

// ── 统计 ──────────────────────────────────────────────────────────────────────
export function updateStats(lm, W, H, lineCount) {
  const q = Math.round(S.presence * 100);
  els.qualityVal.textContent = q; els.qualityBar.style.width = q + "%";
  if (!lm || S.presence <= 0) {
    els.statState.textContent = S.running ? "搜索中" : "未开始";
    els.statFace.textContent = els.statYaw.textContent = els.statLines.textContent = "—";
    setLive(S.running && S.sourceKind === "camera", S.running ? els.live.dataset.k || "运行中" : "待机");
    return;
  }
  els.statState.textContent = S.presence > 0.85 ? "稳定" : "搜索中";
  const bb = faceBBox(lm);
  els.statFace.textContent = Math.round(100 * (bb.w * bb.h) / (W * H)) + "%";
  // 偏航估计：鼻尖相对两颊中点的水平偏移 / 脸宽
  const nose = lm[1], cheekL = lm[234], cheekR = lm[454];
  const cx = (cheekL[0] + cheekR[0]) / 2, fw = Math.abs(cheekR[0] - cheekL[0]) || 1;
  els.statYaw.textContent = ((nose[0] - cx) / fw).toFixed(2);
  els.statLines.textContent = lineCount;
}
