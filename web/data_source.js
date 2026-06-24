// 前端数据源抽象层（见 docs/BACKEND_DATA_ARCHITECTURE.md「前端数据源抽象」、issue #48）。
// UI 不直接 fetch 静态资产或下载文件，统一通过该接口取存数据；
// 今天是纯前端 LocalDataSource，将来 Phase 1 接 Cloudflare Worker + D1 + R2 时
// 换成 ApiDataSource —— 仅替换实现，调用方（标注端/实时端 UI）一行不改。
//
// 已实现（M0「标注 → 实时」闭环所需的最小面）：
//   stagePreviewAtlas(atlas)      暂存一份「标注会话」图谱，供实时端跨页读取做即时预览。
//   takePreviewAtlas()            取出并清除暂存的预览图谱（一次性消费）。
//   stageIncisionOverlay(overlay) 暂存一份切口候选 overlay，供照片/视频/实时画面叠加。
//   loadIncisionOverlay()         读取切口候选 overlay（不清除，便于连续帧使用）。
//
// 规划中（Phase 1 落地 ApiDataSource 时补全）：
//   loadAtlas(system) · saveAnnotation(payload) · listAnnotations(q) · listHeads() · getHeadMesh(id)
//   —— 届时 stagePreviewAtlas/takePreviewAtlas 退化为 saveAnnotation + loadAtlas 的内存快路径。

// 跨页传递用 sessionStorage：同源、随导航存活、关标签即清，
// 恰好匹配「一次性预览、用完即弃、不持久、不发布」的语义。
const PREVIEW_ATLAS_KEY = "langerface.previewAtlas";
const INCISION_OVERLAY_KEY = "langerface.incisionOverlay";

function hasSessionStorage() {
  try { return typeof sessionStorage !== "undefined" && sessionStorage !== null; }
  catch { return false; }
}

export const LocalDataSource = {
  // 暂存预览图谱（医生在标注端点「设为活动图谱并预览」时调用）。
  // 返回是否暂存成功（浏览器禁用存储时返回 false，调用方据此提示）。
  stagePreviewAtlas(atlas) {
    if (!hasSessionStorage()) return false;
    try { sessionStorage.setItem(PREVIEW_ATLAS_KEY, JSON.stringify(atlas)); return true; }
    catch { return false; }
  },

  // 取出一次性预览图谱并立即清除；无暂存或解析失败时返回 null
  //（实时端据此降级为加载内置图谱，绝不因坏数据中断启动）。
  takePreviewAtlas() {
    if (!hasSessionStorage()) return null;
    const raw = sessionStorage.getItem(PREVIEW_ATLAS_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(PREVIEW_ATLAS_KEY);
    try { return JSON.parse(raw); }
    catch { return null; }
  },

  stageIncisionOverlay(overlay) {
    if (!hasSessionStorage()) return false;
    try { sessionStorage.setItem(INCISION_OVERLAY_KEY, JSON.stringify(overlay)); return true; }
    catch { return false; }
  },

  loadIncisionOverlay() {
    if (!hasSessionStorage()) return null;
    const raw = sessionStorage.getItem(INCISION_OVERLAY_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); }
    catch { return null; }
  },

  clearIncisionOverlay() {
    if (hasSessionStorage()) sessionStorage.removeItem(INCISION_OVERLAY_KEY);
  },
};

// 当前数据源实现。Phase 1 在此一行切换为 ApiDataSource（仅换实现，调用方不变）。
export const dataSource = LocalDataSource;
