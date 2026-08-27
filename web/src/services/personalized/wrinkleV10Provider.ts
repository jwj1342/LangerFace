export const WRINKLE_V10_ENDPOINT = "/api/wrinkle-v10";
export const WRINKLE_V10_PROVIDER_SCHEMA = "langerface.wrinkle-v10-provider.v1";
export const WRINKLE_V10_DETECTOR_VERSION = "paired-edge-v10-dynamic-four-region-1.0";
export const WRINKLE_V10_CHECKPOINT_SHA256 =
  "e301b8f70c8239c01504a0616b61acdf9ab9b5796f513d6e7294d4fa52b6a6c2";
export const WRINKLE_V10_HEALTH_TIMEOUT_MS = 5_000;
export const WRINKLE_V10_REQUEST_TIMEOUT_MS = 45_000;

export type WrinkleV10ProcessingLocation = "host_machine" | "remote_service";

export interface WrinkleV10ProviderCapability {
  schemaVersion: typeof WRINKLE_V10_PROVIDER_SCHEMA;
  providerId: string;
  detectorVersion: typeof WRINKLE_V10_DETECTOR_VERSION;
  checkpointSha256: typeof WRINKLE_V10_CHECKPOINT_SHA256;
  processingLocation: WrinkleV10ProcessingLocation;
  ready: true;
}

export function parseWrinkleV10ProviderCapability(
  value: unknown,
): WrinkleV10ProviderCapability {
  const candidate = value as Partial<WrinkleV10ProviderCapability> | null;
  if (candidate?.schemaVersion !== WRINKLE_V10_PROVIDER_SCHEMA
      || candidate.detectorVersion !== WRINKLE_V10_DETECTOR_VERSION
      || candidate.checkpointSha256 !== WRINKLE_V10_CHECKPOINT_SHA256
      || candidate.ready !== true
      || (candidate.processingLocation !== "host_machine"
        && candidate.processingLocation !== "remote_service")
      || typeof candidate.providerId !== "string"
      || !candidate.providerId) {
    throw new Error("V10 检测服务版本或能力声明无效");
  }
  return candidate as WrinkleV10ProviderCapability;
}

function isLoopbackHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

export function wrinkleV10ProcessingLocationLabel(
  capability: WrinkleV10ProviderCapability | null,
  pageHostname: string,
): string {
  if (!capability) return "执行位置待检查";
  if (capability.processingLocation === "remote_service") return "远程 V10 服务";
  return isLoopbackHostname(pageHostname) ? "当前电脑" : "提供网页的局域网电脑";
}
