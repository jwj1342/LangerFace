// DOM 元素引用与 2D 画布上下文。
// 脚本以 type=module 延迟执行，模块求值时 DOM 已就绪，可直接取元素。
const $ = (id) => document.getElementById(id);

export const els = {
  video: $("video"), canvas: $("canvas"), msg: $("overlayMsg"),
  upload: $("uploadBtn"), file: $("fileInput"),
  cam: $("camBtn"), pause: $("pauseBtn"), export: $("exportBtn"),
  tmpl: $("templateSel"), density: $("density"), smooth: $("smooth"), opacity: $("opacity"),
  densityVal: $("densityVal"), smoothVal: $("smoothVal"), opacityVal: $("opacityVal"),
  clip: $("clip"), handOcc: $("handOcc"), mirror: $("mirror"), bands: $("bands"),
  zoom: $("zoom"), zoomStrip: $("zoomStrip"), meshPts: $("meshPts"),
  routeSel: $("routeSel"), route3dPanel: $("route3dPanel"), reconDemo: $("reconDemoBtn"),
  reconScan: $("reconScanBtn"), view3d: $("view3dBtn"), project3d: $("project3dBtn"),
  reset3d: $("reset3dBtn"), scanPanel: $("scanPanel"), scanProgressVal: $("scanProgressVal"),
  scanProgressBar: $("scanProgressBar"), scanYawVal: $("scanYawVal"),
  scanYawLeft: $("scanYawLeft"), scanYawMid: $("scanYawMid"), scanYawRight: $("scanYawRight"),
  scanToast: $("scanToast"), reconStatus: $("reconStatus"), three: $("three"),
  badge: $("modelBadge"), live: $("livePill"), fps: $("fps"),
  qualityVal: $("qualityVal"), qualityBar: $("qualityBar"),
  statState: $("statState"), statFace: $("statFace"), statYaw: $("statYaw"), statLines: $("statLines"),
};

export const ctx = els.canvas.getContext("2d");
