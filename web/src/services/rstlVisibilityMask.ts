/** Fill short visibility jitter while preserving explicit exclusions. */
export function fillShortVisibilityGaps(
  mask: readonly number[],
  hardExcluded: readonly boolean[] = [],
  maxGap = 2,
): number[] {
  const result = [...mask];
  for (let start = 1; start < result.length - 1;) {
    if (result[start]) { start++; continue; }
    let end = start;
    while (end < result.length && !result[end]) end++;
    const hard = Array.from({ length: end - start }, (_, offset) =>
      Boolean(hardExcluded[start + offset])).some(Boolean);
    if (!hard && start > 0 && end < result.length && end - start <= maxGap
      && result[start - 1] && result[end]) {
      for (let index = start; index < end; index++) result[index] = 1;
    }
    start = end;
  }
  return result.map((value, index) => hardExcluded[index] ? 0 : value);
}
