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
  wrinkleDisplayMode: HTMLSelectElement;
  wrinkleDetect: HTMLButtonElement;
  wrinkleAutoRefine: HTMLButtonElement;
  wrinkleRestore: HTMLButtonElement;
  wrinkleStatus: HTMLElement;
  wrinkleSummary: HTMLElement;
  refine2d: HTMLButtonElement;
  refine2dPanel: HTMLElement;
  refine2dStatus: HTMLElement;
  refine2dQuality: HTMLElement;
  refineView: HTMLButtonElement;
  refineDrag: HTMLButtonElement;
  refinePoint: HTMLButtonElement;
  refineErase: HTMLButtonElement;
  refineUndo: HTMLButtonElement;
  refineExport: HTMLButtonElement;
  refineZoomOut: HTMLButtonElement;
  refineZoomReset: HTMLButtonElement;
  refineZoomIn: HTMLButtonElement;
  refineZoomVal: HTMLOutputElement;
  refineSpread: HTMLInputElement;
  refineSpreadVal: HTMLOutputElement;
  refinePointCountWrap: HTMLElement;
  refinePointCount: HTMLInputElement;
  refinePointCountVal: HTMLOutputElement;
  refineNudgeStep: HTMLSelectElement;
  refineNudgeButtons: NodeListOf<HTMLButtonElement>;
  refineSymmetry: HTMLInputElement;
  refineAxis: HTMLInputElement;
  refineReset: HTMLButtonElement;
  refine2dHint: HTMLElement;
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
  incisionWorkflowCard: HTMLElement;
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
    wrinkleDisplayMode: elementById<HTMLSelectElement>(root, "wrinkleDisplayMode") as HTMLSelectElement,
    wrinkleDetect: elementById<HTMLButtonElement>(root, "wrinkleDetectBtn") as HTMLButtonElement,
    wrinkleAutoRefine: elementById<HTMLButtonElement>(root, "wrinkleAutoRefineBtn") as HTMLButtonElement,
    wrinkleRestore: elementById<HTMLButtonElement>(root, "wrinkleRestoreBtn") as HTMLButtonElement,
    wrinkleStatus: elementById<HTMLElement>(root, "wrinkleStatus") as HTMLElement,
    wrinkleSummary: elementById<HTMLElement>(root, "wrinkleSummary") as HTMLElement,
    refine2d: elementById<HTMLButtonElement>(root, "refine2dBtn") as HTMLButtonElement,
    refine2dPanel: elementById<HTMLElement>(root, "refine2dPanel") as HTMLElement,
    refine2dStatus: elementById<HTMLElement>(root, "refine2dStatus") as HTMLElement,
    refine2dQuality: elementById<HTMLElement>(root, "refine2dQuality") as HTMLElement,
    refineView: elementById<HTMLButtonElement>(root, "refineViewBtn") as HTMLButtonElement,
    refineDrag: elementById<HTMLButtonElement>(root, "refineDragBtn") as HTMLButtonElement,
    refinePoint: elementById<HTMLButtonElement>(root, "refinePointBtn") as HTMLButtonElement,
    refineErase: elementById<HTMLButtonElement>(root, "refineEraseBtn") as HTMLButtonElement,
    refineUndo: elementById<HTMLButtonElement>(root, "refineUndoBtn") as HTMLButtonElement,
    refineExport: elementById<HTMLButtonElement>(root, "refineExportBtn") as HTMLButtonElement,
    refineZoomOut: elementById<HTMLButtonElement>(root, "refineZoomOutBtn") as HTMLButtonElement,
    refineZoomReset: elementById<HTMLButtonElement>(root, "refineZoomResetBtn") as HTMLButtonElement,
    refineZoomIn: elementById<HTMLButtonElement>(root, "refineZoomInBtn") as HTMLButtonElement,
    refineZoomVal: elementById<HTMLOutputElement>(root, "refineZoomVal") as HTMLOutputElement,
    refineSpread: elementById<HTMLInputElement>(root, "refineSpread") as HTMLInputElement,
    refineSpreadVal: elementById<HTMLOutputElement>(root, "refineSpreadVal") as HTMLOutputElement,
    refinePointCountWrap: elementById<HTMLElement>(root, "refinePointCountWrap") as HTMLElement,
    refinePointCount: elementById<HTMLInputElement>(root, "refinePointCount") as HTMLInputElement,
    refinePointCountVal: elementById<HTMLOutputElement>(root, "refinePointCountVal") as HTMLOutputElement,
    refineNudgeStep: elementById<HTMLSelectElement>(root, "refineNudgeStep") as HTMLSelectElement,
    refineNudgeButtons: root.querySelectorAll<HTMLButtonElement>("[data-refine-nudge]"),
    refineSymmetry: elementById<HTMLInputElement>(root, "refineSymmetryToggle") as HTMLInputElement,
    refineAxis: elementById<HTMLInputElement>(root, "refineAxisToggle") as HTMLInputElement,
    refineReset: elementById<HTMLButtonElement>(root, "refineResetBtn") as HTMLButtonElement,
    refine2dHint: elementById<HTMLElement>(root, "refine2dHint") as HTMLElement,
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
    incisionWorkflowCard: elementById<HTMLElement>(root, "incisionWorkflowCard") as HTMLElement,
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
