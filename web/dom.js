// DOM 元素引用与 2D 画布上下文。
// React SPA 会反复挂载/卸载页面 DOM；保持 els 对象引用稳定，只替换其字段。
const $ = (root, id) => {
  if (root?.getElementById) return root.getElementById(id);
  if (root?.querySelector) return root.querySelector(`#${id}`);
  return document.getElementById(id);
};

function collectElements(root = document) {
  return {
    video: $(root, "video"),
    canvas: $(root, "canvas"),
    msg: $(root, "overlayMsg"),
    mainWrap: root.querySelector?.(".main-wrap") || document.querySelector(".main-wrap"),
    upload: $(root, "uploadBtn"),
    file: $(root, "fileInput"),
    cam: $(root, "camBtn"),
    pause: $(root, "pauseBtn"),
    export: $(root, "exportBtn"),
    tmpl: $(root, "templateSel"),
    density: $(root, "density"),
    smooth: $(root, "smooth"),
    opacity: $(root, "opacity"),
    prov: $(root, "atlasProvenance"),
    restoreAtlas: $(root, "restoreAtlasBtn"),
    densityVal: $(root, "densityVal"),
    smoothVal: $(root, "smoothVal"),
    opacityVal: $(root, "opacityVal"),
    clip: $(root, "clip"),
    handOcc: $(root, "handOcc"),
    mirror: $(root, "mirror"),
    bands: $(root, "bands"),
    zoom: $(root, "zoom"),
    zoomStrip: $(root, "zoomStrip"),
    meshPts: $(root, "meshPts"),
    routeSel: $(root, "routeSel"),
    route3dPanel: $(root, "route3dPanel"),
    reconDemo: $(root, "reconDemoBtn"),
    routeModeHint: $(root, "routeModeHint"),
    threeDWorkflowCard: $(root, "threeDWorkflowCard"),
    incisionWorkflowCard: $(root, "incisionWorkflowCard"),
    reconScan: $(root, "reconScanBtn"),
    view3d: $(root, "view3dBtn"),
    project3d: $(root, "project3dBtn"),
    reset3d: $(root, "reset3dBtn"),
    cloudFitFlame: $(root, "cloudFitFlameBtn"),
    flameStd: $(root, "flameStdToggle"),
    flameHeadToggleWrap: $(root, "flameHeadToggleWrap"),
    twinTexture: $(root, "twinTextureToggle"),
    twinTextureWrap: $(root, "twinTextureWrap"),
    scanPanel: $(root, "scanPanel"),
    scanProgressVal: $(root, "scanProgressVal"),
    scanProgressBar: $(root, "scanProgressBar"),
    scanYawVal: $(root, "scanYawVal"),
    scanYawLeft: $(root, "scanYawLeft"),
    scanYawMid: $(root, "scanYawMid"),
    scanYawRight: $(root, "scanYawRight"),
    scanToast: $(root, "scanToast"),
    reconStatus: $(root, "reconStatus"),
    three: $(root, "three"),
    badge: $(root, "modelBadge"),
    live: $(root, "livePill"),
    fps: $(root, "fps"),
    qualityVal: $(root, "qualityVal"),
    qualityBar: $(root, "qualityBar"),
    statState: $(root, "statState"),
    statFace: $(root, "statFace"),
    statYaw: $(root, "statYaw"),
    statLines: $(root, "statLines"),
    incisionOverlayQa: $(root, "incisionOverlayQa"),
    incisionOverlayQaState: $(root, "incisionOverlayQaState"),
    incisionOverlayQaDetail: $(root, "incisionOverlayQaDetail"),
  };
}

export const els = {};
export let ctx = null;

export function bindDom(root = document) {
  Object.assign(els, collectElements(root));
  ctx = els.canvas?.getContext("2d") || null;
  return els;
}

bindDom(document);
