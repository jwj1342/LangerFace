const NARROW_VIEWPORT_QUERY = "(max-width: 560px)";
const TOUCH_POINTER_QUERY = "(any-pointer: coarse)";

// This selects a compact touch UI, not a physical phone model. Hover capability
// can coexist with real touch input and must not disable that UI.
export function narrowTouchWorkflowViewportActive(): boolean {
  return typeof window !== "undefined"
    && typeof window.matchMedia === "function"
    && window.matchMedia(NARROW_VIEWPORT_QUERY).matches
    && (navigator.maxTouchPoints > 0 || window.matchMedia(TOUCH_POINTER_QUERY).matches);
}

export function subscribeWorkflowViewport(listener: () => void): () => void {
  const media = [NARROW_VIEWPORT_QUERY, TOUCH_POINTER_QUERY].map((query) => window.matchMedia(query));
  for (const item of media) item.addEventListener("change", listener);
  window.addEventListener("resize", listener);
  return () => {
    for (const item of media) item.removeEventListener("change", listener);
    window.removeEventListener("resize", listener);
  };
}
