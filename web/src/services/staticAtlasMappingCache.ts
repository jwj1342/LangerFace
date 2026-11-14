import { mapAtlas } from "./geometryAtlas.ts";

/** One geometry entry only: never retains photos or a history of faces. */
export function createStaticAtlasMappingCache(mapper: typeof mapAtlas = mapAtlas) {
  let key: string | undefined;
  let value: ReturnType<typeof mapAtlas> | undefined;
  return {
    map(...args: Parameters<typeof mapAtlas>): ReturnType<typeof mapAtlas> {
      // Compare values, including in-place landmark/atlas edits. Object identity
      // alone is insufficient when the renderer reuses mutable arrays.
      const nextKey = JSON.stringify(args);
      if (nextKey !== key || !value) {
        const nextValue = mapper(...args);
        key = nextKey;
        value = nextValue;
      }
      // Callers may edit their display baseline; do not expose cached geometry.
      return structuredClone(value);
    },
    clear() { key = undefined; value = undefined; },
  };
}
