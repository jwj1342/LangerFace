import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "../web/node_modules/typescript/lib/typescript.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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

async function importLiveUiForTests() {
  const source = fs
    .readFileSync(path.join(root, "web/src/services/liveUi.ts"), "utf8")
    .replace('import { els } from "./liveDom";', "const els = globalThis.__liveUiTestEls;");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
  });
  globalThis.__liveUiTestEls = els;
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}

const liveUi = await importLiveUiForTests();

liveUi.setMsg("hello");
assert.equal(els.msg.textContent, "hello");
assert.equal(els.msg.classList.has("hidden"), false);
liveUi.setMsg(null);
assert.equal(els.msg.classList.has("hidden"), true);

liveUi.setLive(true, "实时摄像头");
assert.equal(els.live.dataset.k, "实时摄像头");
assert.equal(els.live.classList.has("on"), true);
assert.ok(els.live.innerHTML.includes("实时摄像头"));
liveUi.setLive(false, "待机");
assert.equal(els.live.classList.has("on"), false);

liveUi.setProvenance({ source: "preview", validated: false, count: 3 });
assert.equal(els.prov.classList.has("hidden"), false);
assert.equal(els.prov.textContent, "活动图谱：preview · 未验证（仅预览） · 3 条线");
liveUi.setProvenance(null);
assert.equal(els.prov.classList.has("hidden"), true);
assert.equal(els.prov.textContent, "");

liveUi.setIncisionOverlayQa({ tone: "warn", label: "姿态需复核", detail: "偏航过大" });
assert.equal(els.incisionOverlayQa.classList.has("hidden"), false);
assert.equal(els.incisionOverlayQa.classList.has("warn"), true);
assert.equal(els.incisionOverlayQaState.textContent, "姿态需复核");
assert.equal(els.incisionOverlayQaDetail.textContent, "偏航过大");
liveUi.setIncisionOverlayQa(null);
assert.equal(els.incisionOverlayQa.classList.has("hidden"), true);
assert.equal(els.incisionOverlayQa.classList.has("warn"), false);

assert.equal(liveUi.smoothLabel(0), "关");
assert.equal(liveUi.smoothLabel(20), "弱");
assert.equal(liveUi.smoothLabel(50), "中");
assert.equal(liveUi.smoothLabel(90), "强");

delete globalThis.__liveUiTestEls;
console.log("test_live_ui: live UI helper assertions passed");
