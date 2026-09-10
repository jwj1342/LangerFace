export interface ImageUploadDimensions {
  width: number;
  height: number;
}

export function likelyMobileScreenshot({ width, height }: ImageUploadDimensions): boolean {
  const normalizedWidth = Math.max(0, Number(width) || 0);
  const normalizedHeight = Math.max(0, Number(height) || 0);
  if (!normalizedWidth || !normalizedHeight) return false;
  return normalizedWidth >= 600
    && normalizedWidth <= 1800
    && normalizedHeight >= 1400
    && normalizedHeight / normalizedWidth >= 1.85;
}

export function confirmLikelyScreenshotUpload(
  file: Pick<File, "name">,
  dimensions: ImageUploadDimensions,
  confirm: (message: string) => boolean = (message) => globalThis.confirm(message),
): boolean {
  if (!likelyMobileScreenshot(dimensions)) return true;
  return confirm([
    `所选图片“${file.name || "未命名图片"}”尺寸为 ${dimensions.width}×${dimensions.height}，看起来更像手机长截图。`,
    "如果截图中还包含本网页，系统会把截图里的人脸再次识别，产生“画中画”效果。",
    "请选择“取消”并改用原始人像；确认确实要使用这张图片时再选择“确定”。",
  ].join("\n\n"));
}
