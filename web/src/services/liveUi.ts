import { els as boundEls } from "./liveDom.ts";
import type { LiveDomElements } from "./liveDom.ts";

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

let testEls: LiveDomElements | null = null;

const els = (): LiveDomElements => testEls ?? boundEls;

export function __setLiveUiElementsForTests(elements: LiveDomElements | null): void {
  testEls = elements;
}

export function setMsg(message: string | null): void {
  const ui = els();
  if (message == null) {
    ui.msg.classList.add("hidden");
  } else {
    ui.msg.textContent = message;
    ui.msg.classList.remove("hidden");
  }
}

export function setLive(on: boolean, label: string): void {
  const ui = els();
  ui.live.dataset.k = label;
  ui.live.classList.toggle("on", Boolean(on));
  ui.live.innerHTML = `<span class="dot"></span>${label}`;
}

export function setProvenance(meta: AtlasProvenanceMeta | null): void {
  const ui = els();
  if (!meta) {
    ui.prov.textContent = "";
    ui.prov.classList.add("hidden");
    return;
  }
  const count = Number.isFinite(meta.count) ? meta.count : 0;
  const source = meta.source || "未知来源";
  const validation = meta.validated ? "已验证" : "未验证（仅预览）";
  ui.prov.textContent = `活动图谱：${source} · ${validation} · ${count} 条线`;
  ui.prov.classList.remove("hidden");
}

export function setIncisionOverlayQa(state: IncisionOverlayQaState | null = null): void {
  const ui = els();
  if (!ui.incisionOverlayQa) return;
  if (!state) {
    ui.incisionOverlayQa.classList.add("hidden");
    ui.incisionOverlayQa.classList.remove("ok", "warn");
    return;
  }
  const tone = state.tone || "pending";
  ui.incisionOverlayQa.classList.remove("hidden", "ok", "warn");
  if (tone === "ok") ui.incisionOverlayQa.classList.add("ok");
  if (tone === "warn") ui.incisionOverlayQa.classList.add("warn");
  ui.incisionOverlayQaState.textContent = state.label || "等待画面";
  ui.incisionOverlayQaDetail.textContent = state.detail || "上传照片、视频或开启摄像头后开始检查。";
}

export function smoothLabel(value: number): string {
  return value === 0 ? "关" : value < 35 ? "弱" : value < 70 ? "中" : "强";
}
