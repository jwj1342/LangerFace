export interface DisposableHead3DResource {
  dispose(): void;
}

export interface OwnedHead3DResource<T extends DisposableHead3DResource> {
  resource: T;
  cleanup?: () => void;
}

export type Head3DResourceFactory<T extends DisposableHead3DResource> = (
  isActive: () => boolean,
) => Promise<OwnedHead3DResource<T> | null>;

export class Head3DResourceLifecycle<T extends DisposableHead3DResource> {
  private generation = 0;
  private resource: T | null = null;
  private cleanup: (() => void) | null = null;
  private pending: Promise<T | null> | null = null;

  capture(): number {
    return this.generation;
  }

  isActive(generation: number): boolean {
    return generation === this.generation;
  }

  current(): T | null {
    return this.resource;
  }

  ensure(generation: number, create: Head3DResourceFactory<T>): Promise<T | null> {
    if (!this.isActive(generation)) return Promise.resolve(null);
    if (this.resource) return Promise.resolve(this.resource);
    if (this.pending) return this.pending;

    const isActive = () => this.isActive(generation);
    let pending: Promise<T | null>;
    pending = (async () => {
      let owned: OwnedHead3DResource<T> | null;
      try {
        owned = await create(isActive);
      } catch (error) {
        if (!isActive()) return null;
        throw error;
      }
      if (!owned) return null;
      if (!isActive()) {
        owned.cleanup?.();
        owned.resource.dispose();
        return null;
      }
      if (this.resource) {
        owned.cleanup?.();
        owned.resource.dispose();
        return this.resource;
      }
      this.resource = owned.resource;
      this.cleanup = owned.cleanup ?? null;
      return owned.resource;
    })().finally(() => {
      if (this.pending === pending) this.pending = null;
    });
    this.pending = pending;
    return pending;
  }

  dispose(): void {
    this.generation += 1;
    this.pending = null;
    const cleanup = this.cleanup;
    const resource = this.resource;
    this.cleanup = null;
    this.resource = null;
    cleanup?.();
    resource?.dispose();
  }
}

export interface Head3DControlCallbacks {
  rotate(deltaX: number, deltaY: number): void;
  zoom(factor: number): void;
  reset(): void;
}

export function bindHead3DControls(
  surface: HTMLCanvasElement,
  callbacks: Head3DControlCallbacks,
): () => void {
  let dragging = false;
  let previousX = 0;
  let previousY = 0;

  const pointerDown = (event: PointerEvent) => {
    dragging = true;
    previousX = event.clientX;
    previousY = event.clientY;
    surface.setPointerCapture(event.pointerId);
  };
  const pointerMove = (event: PointerEvent) => {
    if (!dragging) return;
    callbacks.rotate(event.clientX - previousX, event.clientY - previousY);
    previousX = event.clientX;
    previousY = event.clientY;
  };
  const stopDragging = () => {
    dragging = false;
  };
  const wheel = (event: WheelEvent) => {
    event.preventDefault();
    const delta = Math.max(-160, Math.min(160, event.deltaY || 0));
    callbacks.zoom(Math.exp(delta * 0.001));
  };
  const reset = () => callbacks.reset();

  surface.addEventListener("pointerdown", pointerDown);
  surface.addEventListener("pointermove", pointerMove);
  surface.addEventListener("pointerup", stopDragging);
  surface.addEventListener("pointercancel", stopDragging);
  surface.addEventListener("lostpointercapture", stopDragging);
  surface.addEventListener("wheel", wheel, { passive: false });
  surface.addEventListener("dblclick", reset);

  return () => {
    dragging = false;
    surface.removeEventListener("pointerdown", pointerDown);
    surface.removeEventListener("pointermove", pointerMove);
    surface.removeEventListener("pointerup", stopDragging);
    surface.removeEventListener("pointercancel", stopDragging);
    surface.removeEventListener("lostpointercapture", stopDragging);
    surface.removeEventListener("wheel", wheel);
    surface.removeEventListener("dblclick", reset);
  };
}
