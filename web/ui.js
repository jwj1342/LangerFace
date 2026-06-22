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

export function smoothLabel(v) {
  return v === 0 ? "关" : v < 35 ? "弱" : v < 70 ? "中" : "强";
}
