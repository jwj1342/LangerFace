export type LiveRouteMode = "2d" | "3d";
export type Live3dMode = "view" | "project" | string;

export function enterRoute(route: LiveRouteMode): void;
export function loadDemoRecon(): Promise<void> | void;
export function resetView3d(): void;
export function setMode3d(mode: Live3dMode): void;
export function startScan(): Promise<void> | void;
export function startTwin(): Promise<void> | void;
export function stopTwin(): void;
export function toggleTwinHead(): void;
export function toggleTwinTexture(): void;
