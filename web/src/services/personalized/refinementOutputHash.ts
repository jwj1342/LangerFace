export function stableRefinementSerialization(value: unknown): string {
  const encode = (item: unknown): unknown => {
    if (typeof item === "number") {
      return ["number", Object.is(item, -0) ? "-0" : String(item)];
    }
    if (item === null || typeof item !== "object") return [typeof item, item];
    if (ArrayBuffer.isView(item)) {
      return [item.constructor.name, Array.from(item as unknown as ArrayLike<number>, encode)];
    }
    if (Array.isArray(item)) return ["array", item.map(encode)];
    return ["object", Object.keys(item).sort().map((key) =>
      [key, encode((item as Record<string, unknown>)[key])])];
  };
  return JSON.stringify(encode(value));
}

export async function refinementOutputHashes(result: {
  curves: unknown; diagnostics: unknown; audit: unknown;
}): Promise<Record<string, string>> {
  const hash = async (value: unknown): Promise<string> => {
    const bytes = new TextEncoder().encode(stableRefinementSerialization(value));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  };
  return Object.fromEntries(await Promise.all(
    ["curves", "diagnostics", "audit", "complete"].map(async (name) =>
      [name, await hash(name === "complete" ? result : result[name as keyof typeof result])]),
  ));
}
