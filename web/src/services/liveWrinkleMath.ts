export interface WrinkleWorkingTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export function toWrinkleWorkingPoint(
  point: readonly number[],
  working: WrinkleWorkingTransform,
): [number, number] {
  return [
    point[0] * working.scale + working.offsetX,
    point[1] * working.scale + working.offsetY,
  ];
}

export function fromWrinkleWorkingPoint(
  point: readonly number[],
  working: WrinkleWorkingTransform,
): [number, number] {
  return [
    (point[0] - working.offsetX) / working.scale,
    (point[1] - working.offsetY) / working.scale,
  ];
}
