import assert from "node:assert/strict";
import type { LiveDomElements } from "../web/src/services/liveDom.ts";
import {
  __setLiveUiElementsForTests,
  setIncisionOverlayQa,
  setLive,
  setMsg,
  setProvenance,
  smoothLabel,
} from "../web/src/services/liveUi.ts";

function classList() {
  const classes = new Set();
  return {
    add(...names) { for (const name of names) classes.add(name); },
    remove(...names) { for (const name of names) classes.delete(name); },
    toggle(name, force) {
      if (force) classes.add(name);
      else classes.delete(name);
    },
    has(name) { return classes.has(name); },
  };
}

function element() {
  return {
    classList: classList(),
    dataset: {},
    innerHTML: "",
    textContent: "",
  };
}

const els = {
  msg: element(),
  live: element(),
  prov: element(),
  incisionOverlayQa: element(),
  incisionOverlayQaState: element(),
  incisionOverlayQaDetail: element(),
};

__setLiveUiElementsForTests(els as unknown as LiveDomElements);

setMsg("hello");
assert.equal(els.msg.textContent, "hello");
assert.equal(els.msg.classList.has("hidden"), false);
setMsg(null);
assert.equal(els.msg.classList.has("hidden"), true);

setLive(true, "实时摄像头");
assert.equal(els.live.dataset.k, "实时摄像头");
assert.equal(els.live.classList.has("on"), true);
assert.ok(els.live.innerHTML.includes("实时摄像头"));
setLive(false, "待机");
assert.equal(els.live.classList.has("on"), false);

setProvenance({ source: "preview", validated: false, count: 3 });
assert.equal(els.prov.classList.has("hidden"), false);
assert.equal(els.prov.textContent, "活动图谱：preview · 未验证（仅预览） · 3 条线");
setProvenance(null);
assert.equal(els.prov.classList.has("hidden"), true);
assert.equal(els.prov.textContent, "");

setIncisionOverlayQa({ tone: "warn", label: "姿态需复核", detail: "偏航过大" });
assert.equal(els.incisionOverlayQa.classList.has("hidden"), false);
assert.equal(els.incisionOverlayQa.classList.has("warn"), true);
assert.equal(els.incisionOverlayQaState.textContent, "姿态需复核");
assert.equal(els.incisionOverlayQaDetail.textContent, "偏航过大");
setIncisionOverlayQa(null);
assert.equal(els.incisionOverlayQa.classList.has("hidden"), true);
assert.equal(els.incisionOverlayQa.classList.has("warn"), false);

assert.equal(smoothLabel(0), "关");
assert.equal(smoothLabel(20), "弱");
assert.equal(smoothLabel(50), "中");
assert.equal(smoothLabel(90), "强");

__setLiveUiElementsForTests(null);
console.log("test_live_ui: live UI helper assertions passed");
