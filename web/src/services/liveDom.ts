export interface LiveDomElements {
  video: HTMLVideoElement;
  canvas: HTMLCanvasElement;
  msg: HTMLElement;
  mainWrap: HTMLElement;
  upload: HTMLButtonElement;
  file: HTMLInputElement;
  cam: HTMLButtonElement;
  pause: HTMLButtonElement;
  export: HTMLButtonElement;
  tmpl: HTMLSelectElement;
  density: HTMLInputElement;
  smooth: HTMLInputElement;
  opacity: HTMLInputElement;
  prov: HTMLElement;
  restoreAtlas: HTMLButtonElement;
  densityVal: HTMLElement;
  smoothVal: HTMLElement;
  opacityVal: HTMLElement;
  clip: HTMLInputElement;
  handOcc: HTMLInputElement;
  mirror: HTMLInputElement;
  bands: HTMLInputElement;
  zoom: HTMLInputElement;
  zoomStrip: HTMLElement;
  meshPts: HTMLInputElement;
  routeSel: HTMLSelectElement;
  route3dPanel: HTMLElement;
  reconDemo: HTMLButtonElement;
  routeModeHint: HTMLElement;
  threeDWorkflowCard: HTMLElement;
  incisionWorkflowCard: HTMLElement;
  reconScan: HTMLButtonElement;
  view3d: HTMLButtonElement;
  project3d: HTMLButtonElement;
  reset3d: HTMLButtonElement;
  cloudFitFlame: HTMLButtonElement;
  flameStd: HTMLInputElement;
  flameHeadToggleWrap: HTMLElement;
  twinTexture: HTMLInputElement;
  twinTextureWrap: HTMLElement;
  scanPanel: HTMLElement;
  scanProgressVal: HTMLElement;
  scanProgressBar: HTMLElement;
  scanYawVal: HTMLElement;
  scanYawLeft: HTMLElement;
  scanYawMid: HTMLElement;
  scanYawRight: HTMLElement;
  scanToast: HTMLElement;
  reconStatus: HTMLElement;
  three: HTMLCanvasElement;
  badge: HTMLElement;
  live: HTMLElement;
  fps: HTMLElement;
  qualityVal: HTMLElement;
  qualityBar: HTMLElement;
  statState: HTMLElement;
  statFace: HTMLElement;
  statYaw: HTMLElement;
  statLines: HTMLElement;
  incisionOverlayQa: HTMLElement;
  incisionOverlayQaState: HTMLElement;
  incisionOverlayQaDetail: HTMLElement;
}

const elementById = <T extends Element>(root: ParentNode | Document, id: string): T | null => {
  if ("getElementById" in root && typeof root.getElementById === "function") {
    return root.getElementById(id) as T | null;
  }
  return root.querySelector(`#${id}`) as T | null;
};

const scopedQuery = <T extends Element>(root: ParentNode | Document, selector: string): T | null => (
  root.querySelector(selector) as T | null
);

function collectElements(root: ParentNode | Document): LiveDomElements {
  return {
    video: elementById<HTMLVideoElement>(root, "video") as HTMLVideoElement,
    canvas: elementById<HTMLCanvasElement>(root, "canvas") as HTMLCanvasElement,
    msg: elementById<HTMLElement>(root, "overlayMsg") as HTMLElement,
    mainWrap: scopedQuery<HTMLElement>(root, ".main-wrap") as HTMLElement,
    upload: elementById<HTMLButtonElement>(root, "uploadBtn") as HTMLButtonElement,
    file: elementById<HTMLInputElement>(root, "fileInput") as HTMLInputElement,
    cam: elementById<HTMLButtonElement>(root, "camBtn") as HTMLButtonElement,
    pause: elementById<HTMLButtonElement>(root, "pauseBtn") as HTMLButtonElement,
    export: elementById<HTMLButtonElement>(root, "exportBtn") as HTMLButtonElement,
    tmpl: elementById<HTMLSelectElement>(root, "templateSel") as HTMLSelectElement,
    density: elementById<HTMLInputElement>(root, "density") as HTMLInputElement,
    smooth: elementById<HTMLInputElement>(root, "smooth") as HTMLInputElement,
    opacity: elementById<HTMLInputElement>(root, "opacity") as HTMLInputElement,
    prov: elementById<HTMLElement>(root, "atlasProvenance") as HTMLElement,
    restoreAtlas: elementById<HTMLButtonElement>(root, "restoreAtlasBtn") as HTMLButtonElement,
    densityVal: elementById<HTMLElement>(root, "densityVal") as HTMLElement,
    smoothVal: elementById<HTMLElement>(root, "smoothVal") as HTMLElement,
    opacityVal: elementById<HTMLElement>(root, "opacityVal") as HTMLElement,
    clip: elementById<HTMLInputElement>(root, "clip") as HTMLInputElement,
    handOcc: elementById<HTMLInputElement>(root, "handOcc") as HTMLInputElement,
    mirror: elementById<HTMLInputElement>(root, "mirror") as HTMLInputElement,
    bands: elementById<HTMLInputElement>(root, "bands") as HTMLInputElement,
    zoom: elementById<HTMLInputElement>(root, "zoom") as HTMLInputElement,
    zoomStrip: elementById<HTMLElement>(root, "zoomStrip") as HTMLElement,
    meshPts: elementById<HTMLInputElement>(root, "meshPts") as HTMLInputElement,
    routeSel: elementById<HTMLSelectElement>(root, "routeSel") as HTMLSelectElement,
    route3dPanel: elementById<HTMLElement>(root, "route3dPanel") as HTMLElement,
    reconDemo: elementById<HTMLButtonElement>(root, "reconDemoBtn") as HTMLButtonElement,
    routeModeHint: elementById<HTMLElement>(root, "routeModeHint") as HTMLElement,
    threeDWorkflowCard: elementById<HTMLElement>(root, "threeDWorkflowCard") as HTMLElement,
    incisionWorkflowCard: elementById<HTMLElement>(root, "incisionWorkflowCard") as HTMLElement,
    reconScan: elementById<HTMLButtonElement>(root, "reconScanBtn") as HTMLButtonElement,
    view3d: elementById<HTMLButtonElement>(root, "view3dBtn") as HTMLButtonElement,
    project3d: elementById<HTMLButtonElement>(root, "project3dBtn") as HTMLButtonElement,
    reset3d: elementById<HTMLButtonElement>(root, "reset3dBtn") as HTMLButtonElement,
    cloudFitFlame: elementById<HTMLButtonElement>(root, "cloudFitFlameBtn") as HTMLButtonElement,
    flameStd: elementById<HTMLInputElement>(root, "flameStdToggle") as HTMLInputElement,
    flameHeadToggleWrap: elementById<HTMLElement>(root, "flameHeadToggleWrap") as HTMLElement,
    twinTexture: elementById<HTMLInputElement>(root, "twinTextureToggle") as HTMLInputElement,
    twinTextureWrap: elementById<HTMLElement>(root, "twinTextureWrap") as HTMLElement,
    scanPanel: elementById<HTMLElement>(root, "scanPanel") as HTMLElement,
    scanProgressVal: elementById<HTMLElement>(root, "scanProgressVal") as HTMLElement,
    scanProgressBar: elementById<HTMLElement>(root, "scanProgressBar") as HTMLElement,
    scanYawVal: elementById<HTMLElement>(root, "scanYawVal") as HTMLElement,
    scanYawLeft: elementById<HTMLElement>(root, "scanYawLeft") as HTMLElement,
    scanYawMid: elementById<HTMLElement>(root, "scanYawMid") as HTMLElement,
    scanYawRight: elementById<HTMLElement>(root, "scanYawRight") as HTMLElement,
    scanToast: elementById<HTMLElement>(root, "scanToast") as HTMLElement,
    reconStatus: elementById<HTMLElement>(root, "reconStatus") as HTMLElement,
    three: elementById<HTMLCanvasElement>(root, "three") as HTMLCanvasElement,
    badge: elementById<HTMLElement>(root, "modelBadge") as HTMLElement,
    live: elementById<HTMLElement>(root, "livePill") as HTMLElement,
    fps: elementById<HTMLElement>(root, "fps") as HTMLElement,
    qualityVal: elementById<HTMLElement>(root, "qualityVal") as HTMLElement,
    qualityBar: elementById<HTMLElement>(root, "qualityBar") as HTMLElement,
    statState: elementById<HTMLElement>(root, "statState") as HTMLElement,
    statFace: elementById<HTMLElement>(root, "statFace") as HTMLElement,
    statYaw: elementById<HTMLElement>(root, "statYaw") as HTMLElement,
    statLines: elementById<HTMLElement>(root, "statLines") as HTMLElement,
    incisionOverlayQa: elementById<HTMLElement>(root, "incisionOverlayQa") as HTMLElement,
    incisionOverlayQaState: elementById<HTMLElement>(root, "incisionOverlayQaState") as HTMLElement,
    incisionOverlayQaDetail: elementById<HTMLElement>(root, "incisionOverlayQaDetail") as HTMLElement,
  };
}

export const els = {} as LiveDomElements;
export let ctx: CanvasRenderingContext2D | null = null;

export function clearDomBinding(): void {
  for (const key of Object.keys(els) as Array<keyof LiveDomElements>) delete els[key];
  ctx = null;
}

export function bindDom(root: ParentNode | Document = document): LiveDomElements {
  clearDomBinding();
  Object.assign(els, collectElements(root));
  ctx = els.canvas?.getContext("2d") || null;
  return els;
}
