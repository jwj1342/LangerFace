type Style = Pick<CanvasRenderingContext2D,
  "fillStyle" | "strokeStyle" | "globalAlpha" | "lineWidth" | "lineCap" | "lineJoin"> & {
  dash: number[];
};

export type OverlayPathContext = Omit<Style, "dash"> & Pick<CanvasRenderingContext2D,
  "save" | "restore" | "beginPath" | "moveTo" | "lineTo" | "arc" | "fill" | "stroke" | "setLineDash">;

type Mark = { d: string; style: Style; stroke: boolean };
type Box = { sx: number; sy: number; sw: number; sh: number };

const ns = "http://www.w3.org/2000/svg";
const overlays = new WeakMap<HTMLCanvasElement, PhotoVectorOverlay>();
const coord = (value: number) => Math.round(value * 1000) / 1000;

export function photoVectorOverlay(canvas: HTMLCanvasElement): PhotoVectorOverlay | undefined {
  const existing = overlays.get(canvas);
  if (existing) return existing;
  const svg = canvas.parentElement?.querySelector<SVGSVGElement>("#workflowPhotoVectors");
  if (!svg) return;
  const overlay = new PhotoVectorOverlay(canvas, svg);
  overlays.set(canvas, overlay);
  return overlay;
}

export function syncPhotoVectorView(canvas: HTMLCanvasElement): void {
  overlays.get(canvas)?.syncView();
}

export function clearPhotoVectors(canvas: HTMLCanvasElement): void {
  overlays.get(canvas)?.clear();
}

export function paintPhotoVectors(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D): void {
  overlays.get(canvas)?.paint(context);
}

function attribute(element: SVGElement, key: string, value: string) {
  if (element.getAttribute(key) !== value) element.setAttribute(key, value);
}

// Only the polyline and full-circle primitives used by the photo renderer.
// Canvas replay is used for raster exports and the small detail thumbnails.
export class PhotoVectorOverlay implements OverlayPathContext {
  fillStyle: Style["fillStyle"] = "#000";
  strokeStyle: Style["strokeStyle"] = "#000";
  globalAlpha = 1;
  lineWidth = 1;
  lineCap: CanvasLineCap = "butt";
  lineJoin: CanvasLineJoin = "miter";
  private dash: number[] = [];
  private stack: Style[] = [];
  private commands: string[] = [];
  private marks: Mark[] = [];
  private crop: Box | null = null;
  private active = false;
  private composite: HTMLCanvasElement | null = null;
  private readonly canvas: HTMLCanvasElement;
  private readonly svg: SVGSVGElement;

  constructor(canvas: HTMLCanvasElement, svg: SVGSVGElement) {
    this.canvas = canvas;
    this.svg = svg;
  }

  beginFrame() {
    this.stack.length = 0;
    this.marks.length = 0;
    this.crop = null;
  }

  private style(): Style {
    const { fillStyle, strokeStyle, globalAlpha, lineWidth, lineCap, lineJoin, dash } = this;
    return { fillStyle, strokeStyle, globalAlpha, lineWidth, lineCap, lineJoin, dash };
  }

  save() { this.stack.push(this.style()); }
  restore() {
    const style = this.stack.pop();
    if (style) Object.assign(this, style);
  }
  setLineDash(values: number[]) { this.dash = values.slice(); }
  beginPath() { this.commands.length = 0; }
  moveTo(x: number, y: number) {
    if (Number.isFinite(x) && Number.isFinite(y)) this.commands.push(`M${coord(x)} ${coord(y)}`);
  }
  lineTo(x: number, y: number) {
    if (Number.isFinite(x) && Number.isFinite(y)) this.commands.push(`${this.commands.length ? "L" : "M"}${coord(x)} ${coord(y)}`);
  }
  arc(x: number, y: number, radius: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(radius) || radius <= 0) return;
    this.commands.push(`M${x + radius} ${y}A${radius} ${radius} 0 1 1 ${x - radius} ${y}A${radius} ${radius} 0 1 1 ${x + radius} ${y}Z`);
  }
  fill() { this.mark(false); }
  stroke() { this.mark(true); }

  private mark(stroke: boolean) {
    if (this.commands.length) this.marks.push({ d: this.commands.join(""), style: this.style(), stroke });
  }

  syncView() {
    if (!this.active) return;
    const style = this.canvas.style;
    this.svg.style.width = style.width;
    this.svg.style.height = style.height;
    const transform = `translate(${style.getPropertyValue("--img-pan-x") || "0px"}, ${style.getPropertyValue("--img-pan-y") || "0px"}) scale(${style.getPropertyValue("--img-zoom") || "1"})`;
    this.svg.style.transform = this.canvas.classList.contains("mirror") ? `${transform} scaleX(-1)` : transform;
  }

  show(crop: Box | null) {
    this.crop = crop;
    this.active = true;
    this.svg.style.display = "";
    this.syncView();
    attribute(this.svg, "viewBox", crop ? `${crop.sx} ${crop.sy} ${crop.sw} ${crop.sh}` : `0 0 ${this.canvas.width} ${this.canvas.height}`);
    this.marks.forEach(({ d, style, stroke }, index) => {
      let path = this.svg.children[index] as SVGPathElement | undefined;
      if (!path) {
        path = this.svg.ownerDocument.createElementNS(ns, "path");
        this.svg.appendChild(path);
      }
      attribute(path, "d", d);
      attribute(path, "opacity", String(style.globalAlpha));
      attribute(path, "fill", stroke ? "none" : String(style.fillStyle));
      attribute(path, "stroke", stroke ? String(style.strokeStyle) : "none");
      attribute(path, "stroke-width", String(style.lineWidth));
      attribute(path, "stroke-linecap", style.lineCap);
      attribute(path, "stroke-linejoin", style.lineJoin);
      attribute(path, "stroke-dasharray", style.dash.join(" ") || "none");
    });
    while (this.svg.children.length > this.marks.length) this.svg.lastElementChild?.remove();
  }

  clear() {
    this.beginFrame();
    this.active = false;
    this.composite = null;
    this.svg.style.display = "none";
    this.svg.replaceChildren();
  }

  paint(context: CanvasRenderingContext2D, crop = this.crop) {
    if (!this.marks.length) return;
    context.save();
    if (crop) {
      context.scale(this.canvas.width / crop.sw, this.canvas.height / crop.sh);
      context.translate(-crop.sx, -crop.sy);
    }
    for (const { d, style, stroke } of this.marks) {
      const path = new Path2D(d);
      context.globalAlpha = style.globalAlpha;
      if (stroke) {
        context.strokeStyle = style.strokeStyle;
        context.lineWidth = style.lineWidth;
        context.lineCap = style.lineCap;
        context.lineJoin = style.lineJoin;
        context.setLineDash(style.dash);
        context.stroke(path);
      } else {
        context.fillStyle = style.fillStyle;
        context.fill(path);
      }
    }
    context.restore();
  }

  uncroppedComposite(): HTMLCanvasElement {
    const canvas = this.composite ??= this.canvas.ownerDocument.createElement("canvas");
    if (canvas.width !== this.canvas.width) canvas.width = this.canvas.width;
    if (canvas.height !== this.canvas.height) canvas.height = this.canvas.height;
    const context = canvas.getContext("2d");
    if (!context) return this.canvas;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(this.canvas, 0, 0);
    this.paint(context, null);
    return canvas;
  }
}
