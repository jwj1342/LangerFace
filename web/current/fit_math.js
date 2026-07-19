export function fitContainSize(contentWidth, contentHeight, containerWidth, containerHeight, { allowUpscale = true } = {}) {
  const srcW = Math.max(1, Number(contentWidth) || 0);
  const srcH = Math.max(1, Number(contentHeight) || 0);
  const boxW = Math.max(0, Number(containerWidth) || 0);
  const boxH = Math.max(0, Number(containerHeight) || 0);
  if (!boxW || !boxH) return { width: 0, height: 0, scale: 0 };

  let scale = Math.min(boxW / srcW, boxH / srcH);
  if (!allowUpscale) scale = Math.min(scale, 1);
  return {
    width: Math.max(1, Math.round(srcW * scale)),
    height: Math.max(1, Math.round(srcH * scale)),
    scale,
  };
}
