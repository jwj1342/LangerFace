/** Limit secondary previews without delaying the main tracking/render loop. */
export class LivePreviewCadence {
  private previous = -Infinity;

  shouldDraw(now: number, force = false): boolean {
    if (!force && now >= this.previous && now - this.previous < 1000 / 15) return false;
    this.previous = now;
    return true;
  }

  reset(): void {
    this.previous = -Infinity;
  }
}
