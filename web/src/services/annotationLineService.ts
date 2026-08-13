import type { AnnotationLine, AnnotationModel } from "./annotationModel";

export interface AnnotationLineDraft {
  name: string;
  region: string;
}

export type AnnotationLineStartResult =
  | { status: "started"; line: AnnotationLine }
  | { status: "blocked"; line: AnnotationLine };

export type AnnotationLineSaveResult =
  | { status: "saved"; line: AnnotationLine }
  | { status: "no_current" }
  | { status: "too_short"; controlCount: number };

export type AnnotationLineUndoResult =
  | { status: "point"; remaining: number }
  | { status: "cancelled" }
  | { status: "restored"; line: AnnotationLine }
  | { status: "empty" };

export type AnnotationLineRestoreResult =
  | { status: "restored"; line: AnnotationLine }
  | { status: "blocked" }
  | { status: "missing" };

function controlCount(line?: AnnotationLine | null): number {
  return line ? (line.controls || line.points).length : 0;
}

export class AnnotationLineService {
  private readonly model: AnnotationModel;

  constructor(model: AnnotationModel) {
    this.model = model;
  }

  draft(name = "", region = ""): AnnotationLineDraft {
    const next = this.model.lines.length + 1;
    return {
      name: name.trim() || `${this.model.system}_${String(next).padStart(2, "0")}`,
      region: region.trim(),
    };
  }

  start(draft: AnnotationLineDraft): AnnotationLineStartResult {
    if (this.model.current) return { status: "blocked", line: this.model.current };
    this.model.startLine(draft);
    const line = this.model.current;
    if (!line) throw new Error("AnnotationModel.startLine() did not create a current line");
    return { status: "started", line };
  }

  save(): AnnotationLineSaveResult {
    if (!this.model.current) return { status: "no_current" };
    const count = controlCount(this.model.current);
    if (count < 2) return { status: "too_short", controlCount: count };
    return { status: "saved", line: this.model.finishLine() as AnnotationLine };
  }

  undo(): AnnotationLineUndoResult {
    if (this.model.current && controlCount(this.model.current)) {
      this.model.undoPoint();
      return { status: "point", remaining: controlCount(this.model.current) };
    }
    if (this.model.current) {
      this.model.cancelLine();
      return { status: "cancelled" };
    }
    const line = this.model.lines.pop();
    if (!line) return { status: "empty" };
    this.model.current = line;
    return { status: "restored", line };
  }

  restore(index: number): AnnotationLineRestoreResult {
    if (this.model.current && controlCount(this.model.current)) return { status: "blocked" };
    if (this.model.current) this.model.cancelLine();
    const [line] = this.model.lines.splice(index, 1);
    if (!line) return { status: "missing" };
    this.model.current = line;
    return { status: "restored", line };
  }

  clear(): void {
    this.model.clear();
  }

  delete(index: number): boolean {
    const count = this.model.lines.length;
    this.model.deleteLine(index);
    return this.model.lines.length < count;
  }
}
