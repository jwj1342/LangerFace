export function ensureReady(): Promise<void>;
export function handleFile(file?: File): Promise<void> | void;
export function requestFrame(): void;
export function restoreOfficialAtlas(system: string): boolean;
export function setActiveAtlas(system: string, atlas: unknown): boolean;
export function startCamera(): Promise<void> | void;
export function stopSource(): void;
