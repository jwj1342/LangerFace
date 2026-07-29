// 轻量 UI 辅助：覆盖消息、实时状态指示、平滑档位文案。
import { els } from "./dom.js";

export function setMsg(t) {
  if (t == null) els.msg.classList.add("hidden");
  else { els.msg.textContent = t; els.msg.classList.remove("hidden"); }
}

export function setLive(on, label) {
  els.live.dataset.k = label;
  els.live.classList.toggle("on", !!on);
  els.live.innerHTML = `<span class="dot"></span>${label}`;
}

export function setProvenance(meta) {
  if (!meta) {
    els.prov.textContent = "";
    els.prov.classList.add("hidden");
    return;
  }
  const count = Number.isFinite(meta.count) ? meta.count : 0;
  const source = meta.source || "未知来源";
  const validation = meta.validated ? "已验证" : "未验证（仅预览）";
  els.prov.textContent = `活动图谱：${source} · ${validation} · ${count} 条线`;
  els.prov.classList.remove("hidden");
}

export function smoothLabel(v) {
  return v === 0 ? "关" : v < 35 ? "弱" : v < 70 ? "中" : "强";
}
