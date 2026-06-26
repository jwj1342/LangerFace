export interface FitContainOptions {
  allowUpscale?: boolean;
}

export interface FitContainResult {
  width: number;
  height: number;
  scale: number;
}

export function fitContainSize(
  contentWidth: number,
  contentHeight: number,
  containerWidth: number,
  containerHeight: number,
  options?: FitContainOptions,
): FitContainResult;
