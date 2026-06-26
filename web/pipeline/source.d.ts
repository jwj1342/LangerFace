export function startCamera(): Promise<void>;
export function showCameraPlaceholder(message?: string): void;
export function handleFile(file?: File): Promise<void> | void;
export function setSource(src: CanvasImageSource, kind: "camera" | "video" | "image", width?: number, height?: number): void;
export function stopSource(): void;
