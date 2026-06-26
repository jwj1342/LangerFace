import { els } from "./liveDom";

export interface AtlasProvenanceMeta {
  source?: string;
  validated?: boolean;
  count?: number;
}

export interface IncisionOverlayQaState {
  tone?: "ok" | "warn" | "pending";
  label?: string;
  detail?: string;
}

export function setMsg(message: string | null): void {
  if (message == null) {
    els.msg.classList.add("hidden");
  } else {
    els.msg.textContent = message;
    els.msg.classList.remove("hidden");
  }
}

export function setLive(on: boolean, label: string): void {
  els.live.dataset.k = label;
  els.live.classList.toggle("on", Boolean(on));
  els.live.innerHTML = `<span class="dot"></span>${label}`;
}

export function setProvenance(meta: AtlasProvenanceMeta | null): void {
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

export function setIncisionOverlayQa(state: IncisionOverlayQaState | null = null): void {
  if (!els.incisionOverlayQa) return;
  if (!state) {
    els.incisionOverlayQa.classList.add("hidden");
    els.incisionOverlayQa.classList.remove("ok", "warn");
    return;
  }
  const tone = state.tone || "pending";
  els.incisionOverlayQa.classList.remove("hidden", "ok", "warn");
  if (tone === "ok") els.incisionOverlayQa.classList.add("ok");
  if (tone === "warn") els.incisionOverlayQa.classList.add("warn");
  els.incisionOverlayQaState.textContent = state.label || "等待画面";
  els.incisionOverlayQaDetail.textContent = state.detail || "上传照片、视频或开启摄像头后开始检查。";
}

export function smoothLabel(value: number): string {
  return value === 0 ? "关" : value < 35 ? "弱" : value < 70 ? "中" : "强";
}
