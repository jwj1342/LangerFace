export interface LiveZoomCard {
  canvas: HTMLCanvasElement;
  card: HTMLElement;
  ctx: CanvasRenderingContext2D;
  region?: unknown;
}

export function adjustFocusZoom(deltaY: number): boolean;
export function buildZoomCards(refreshStaticImage?: () => void): void;
export function clearZooms(): void;
export function draw(landmarks: number[][], width: number, height: number, hulls?: unknown[]): number;
export function drawFocusedRegion(landmarks: number[][], width: number, height: number): void;
export function drawZooms(landmarks: number[][], width: number): void;
export function updateStats(landmarks: number[][] | null, width: number, height: number, lineCount: number): void;
