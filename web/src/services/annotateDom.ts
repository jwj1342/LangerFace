import { requireScopedElement } from "../lib/scopedDom";

export interface AnnotateDomElements {
  stage: HTMLCanvasElement;
  system: HTMLSelectElement;
  name: HTMLInputElement;
  region: HTMLInputElement;
  btnNew: HTMLButtonElement;
  btnUndo: HTMLButtonElement;
  btnFinish: HTMLButtonElement;
  btnClear: HTMLButtonElement;
  exAtlas: HTMLButtonElement;
  exXyz: HTMLButtonElement;
  setActive: HTMLButtonElement;
  loadCanonical: HTMLButtonElement;
  loadFlame: HTMLButtonElement;
  loadFittedFlame: HTMLButtonElement;
  meshFile: HTMLInputElement;
  slicerFile: HTMLInputElement;
  resampleSpacing: HTMLInputElement;
  list: HTMLElement;
  status: HTMLElement;
  hint: HTMLElement;
  current: HTMLElement;
  drawMode: HTMLElement;
}

const element = <T extends Element>(root: ParentNode | Document, id: string): T => {
  return requireScopedElement<T>(root, id);
};

export function collectAnnotateElements(
  root: ParentNode | Document = document,
): AnnotateDomElements {
  return {
    stage: element<HTMLCanvasElement>(root, "stage"),
    system: element<HTMLSelectElement>(root, "annSystem"),
    name: element<HTMLInputElement>(root, "annName"),
    region: element<HTMLInputElement>(root, "annRegion"),
    btnNew: element<HTMLButtonElement>(root, "btnNew"),
    btnUndo: element<HTMLButtonElement>(root, "btnUndo"),
    btnFinish: element<HTMLButtonElement>(root, "btnFinish"),
    btnClear: element<HTMLButtonElement>(root, "btnClear"),
    exAtlas: element<HTMLButtonElement>(root, "btnExportAtlas"),
    exXyz: element<HTMLButtonElement>(root, "btnExportXyz"),
    setActive: element<HTMLButtonElement>(root, "btnSetActiveAtlas"),
    loadCanonical: element<HTMLButtonElement>(root, "btnLoadCanonical"),
    loadFlame: element<HTMLButtonElement>(root, "btnLoadFlame"),
    loadFittedFlame: element<HTMLButtonElement>(root, "btnLoadFittedFlame"),
    meshFile: element<HTMLInputElement>(root, "meshFile"),
    slicerFile: element<HTMLInputElement>(root, "slicerFile"),
    resampleSpacing: element<HTMLInputElement>(root, "resampleSpacing"),
    list: element<HTMLElement>(root, "lineList"),
    status: element<HTMLElement>(root, "annStatus"),
    hint: element<HTMLElement>(root, "hint"),
    current: element<HTMLElement>(root, "currentState"),
    drawMode: element<HTMLElement>(root, "drawMode"),
  };
}

export function annotateFileFromEvent(event: Event): File | undefined {
  return (event.target as HTMLInputElement | null)?.files?.[0] ?? undefined;
}

export function isAnnotateTextControl(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}
