export interface LiveZoomCard {
  canvas: HTMLCanvasElement;
  card?: HTMLElement | null;
}

export function adjustFocusZoom(deltaY: number): boolean;
export function buildZoomCards(refreshStaticImage?: () => void): void;
