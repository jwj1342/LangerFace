export const RSTL_STANDARD_CONTRACT = Object.freeze({
  atlasVersion: "8.1.96",
  curveCount: 204,
  pointCount: 19_030,
  expandForehead: true,
});

interface RstlAtlasPayloadLike {
  atlasVersion?: unknown;
  validated?: unknown;
  lines?: unknown[];
}

export function assertStandardRstlAtlas(payload: RstlAtlasPayloadLike): void {
  const lines = payload?.lines;
  const pointCount = Array.isArray(lines)
    ? lines.reduce<number>((sum, line) => {
        const points = line && typeof line === "object"
          ? (line as { points?: unknown }).points
          : null;
        return sum + (Array.isArray(points) ? points.length : 0);
      }, 0)
    : 0;
  if (payload?.validated !== false ||
      payload?.atlasVersion !== RSTL_STANDARD_CONTRACT.atlasVersion ||
      !Array.isArray(lines) ||
      lines.length !== RSTL_STANDARD_CONTRACT.curveCount ||
      pointCount !== RSTL_STANDARD_CONTRACT.pointCount) {
    throw new Error(
      `RSTL atlas 必须是 validated=false 的 v${RSTL_STANDARD_CONTRACT.atlasVersion} ` +
      `${RSTL_STANDARD_CONTRACT.curveCount} 曲线 / ${RSTL_STANDARD_CONTRACT.pointCount} 点版本`,
    );
  }
}
