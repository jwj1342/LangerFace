export function scopedElementById<T extends Element = HTMLElement>(
  root: ParentNode | Document,
  id: string,
): T | null {
  if ("getElementById" in root && typeof root.getElementById === "function") {
    return root.getElementById(id) as T | null;
  }
  return root.querySelector(`#${id}`) as T | null;
}

export function requireScopedElement<T extends Element = HTMLElement>(
  root: ParentNode | Document,
  id: string,
): T {
  const element = scopedElementById<T>(root, id);
  if (!element) throw new Error(`React route host is missing #${id}.`);
  return element;
}

export function requireScopedQuery<T extends Element = HTMLElement>(
  root: ParentNode | Document,
  selector: string,
): T {
  const element = root.querySelector(selector) as T | null;
  if (!element) throw new Error(`React route host is missing ${selector}.`);
  return element;
}
