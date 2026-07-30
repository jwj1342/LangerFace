export interface IncisionEdit {
  angle_offset_deg: number;
  length_scale: number;
  width_scale: number;
  tip_angle_deg: number | null;
  shift_along_mm: number;
  shift_perp_mm: number;
  reason: string;
  session_history?: IncisionEditHistoryEntry[];
  [key: string]: unknown;
}

export interface IncisionEditHistoryEntry extends IncisionEdit {
  interaction?: string;
  committed_at?: string;
  source?: string;
  history_index?: number;
}

export interface IncisionEditHistorySummary {
  committedCount: number;
  historyCount: number;
  version: number;
  uncommitted: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

export function neutralIncisionEdit(): IncisionEdit {
  return {
    angle_offset_deg: 0,
    length_scale: 1,
    width_scale: 1,
    tip_angle_deg: null,
    shift_along_mm: 0,
    shift_perp_mm: 0,
    reason: "",
  };
}

export function cloneIncisionEdit(
  edit: Partial<IncisionEdit> = neutralIncisionEdit(),
): IncisionEdit {
  return {
    angle_offset_deg: Number(edit.angle_offset_deg || 0),
    length_scale: Number(edit.length_scale || 1),
    width_scale: Number(edit.width_scale || 1),
    tip_angle_deg: edit.tip_angle_deg == null ? null : Number(edit.tip_angle_deg),
    shift_along_mm: Number(edit.shift_along_mm || 0),
    shift_perp_mm: Number(edit.shift_perp_mm || 0),
    reason: String(edit.reason || ""),
  };
}

export function incisionEditsEqual(
  first: Partial<IncisionEdit> = neutralIncisionEdit(),
  second: Partial<IncisionEdit> = neutralIncisionEdit(),
): boolean {
  return (
    Number(first.angle_offset_deg || 0) === Number(second.angle_offset_deg || 0)
    && Number(first.length_scale || 1) === Number(second.length_scale || 1)
    && Number(first.width_scale || 1) === Number(second.width_scale || 1)
    && (first.tip_angle_deg == null ? null : Number(first.tip_angle_deg))
      === (second.tip_angle_deg == null ? null : Number(second.tip_angle_deg))
    && Number(first.shift_along_mm || 0) === Number(second.shift_along_mm || 0)
    && Number(first.shift_perp_mm || 0) === Number(second.shift_perp_mm || 0)
    && String(first.reason || "") === String(second.reason || "")
  );
}

export function incisionEditIsActive(
  edit: Partial<IncisionEdit> = neutralIncisionEdit(),
): boolean {
  return (
    edit.angle_offset_deg !== 0
    || edit.length_scale !== 1
    || edit.width_scale !== 1
    || edit.tip_angle_deg != null
    || edit.shift_along_mm !== 0
    || edit.shift_perp_mm !== 0
    || Boolean(edit.reason)
  );
}

export class IncisionEditHistory {
  private timeline: IncisionEditHistoryEntry[] = [];
  private cursor = 0;

  constructor() {
    this.reset();
  }

  reset(): void {
    this.timeline = [neutralIncisionEdit()];
    this.cursor = 0;
  }

  entriesFor(edit: Partial<IncisionEdit>): IncisionEditHistoryEntry[] {
    const rawCommitted = this.timeline.slice(1, Math.max(1, this.cursor + 1));
    const committedSource = rawCommitted.some((entry) => incisionEditIsActive(entry))
      ? rawCommitted
      : rawCommitted.filter((entry) => incisionEditIsActive(entry));
    const committed = committedSource.map((entry, index) => ({
      ...cloneIncisionEdit(entry),
      source: "web/incision_workflow",
      interaction: entry.interaction || "committed_control_edit",
      history_index: index + 1,
    }));
    const cursorEdit = this.timeline[this.cursor] || neutralIncisionEdit();
    if (!incisionEditsEqual(edit, cursorEdit) && incisionEditIsActive(edit)) {
      committed.push({
        ...cloneIncisionEdit(edit),
        source: "web/incision_workflow",
        interaction: "live_preview_uncommitted_edit",
        history_index: committed.length + 1,
      });
    }
    return committed;
  }

  summary(edit: Partial<IncisionEdit>): IncisionEditHistorySummary {
    const historyCount = this.entriesFor(edit).length;
    return {
      committedCount: Math.max(0, this.cursor),
      historyCount,
      version: 1 + historyCount,
      uncommitted: !incisionEditsEqual(
        edit,
        this.timeline[this.cursor] || neutralIncisionEdit(),
      ),
      canUndo: this.cursor > 0,
      canRedo: this.cursor < this.timeline.length - 1,
    };
  }

  commit(
    edit: Partial<IncisionEdit>,
    interaction = "control_change",
    committedAt = new Date().toISOString(),
  ): boolean {
    const entry: IncisionEditHistoryEntry = {
      ...cloneIncisionEdit(edit),
      interaction,
      committed_at: committedAt,
    };
    const current = this.timeline[this.cursor] || neutralIncisionEdit();
    if (incisionEditsEqual(entry, current)) return false;
    this.timeline = this.timeline.slice(0, this.cursor + 1);
    this.timeline.push(entry);
    this.cursor = this.timeline.length - 1;
    return true;
  }

  undo(): IncisionEdit | null {
    if (this.cursor <= 0) return null;
    this.cursor -= 1;
    return cloneIncisionEdit(this.timeline[this.cursor]);
  }

  redo(): IncisionEdit | null {
    if (this.cursor >= this.timeline.length - 1) return null;
    this.cursor += 1;
    return cloneIncisionEdit(this.timeline[this.cursor]);
  }
}
