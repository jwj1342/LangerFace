/**
 * Developer-only UI gate.
 * Production builds must never reveal local media filenames.
 */
export function isDeveloperMode(): boolean {
  if (!import.meta.env.DEV || typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  return params.get("developer") === "1" || params.get("markerDiagnostics") === "1";
}
