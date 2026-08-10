import { TOPOLOGY_ID, TOPOLOGY_VERSION } from "./constants.ts";

export const RSTL_SOURCE_CONTRACT_SCHEMA = "rstl-source-contract/v0.1";

export interface RstlSourceContract {
  schema_version: typeof RSTL_SOURCE_CONTRACT_SCHEMA;
  system: string;
  atlas_version: string;
  topology_id: string;
  topology_version: string;
  provenance: string;
  validated: boolean;
  line_count: number;
  point_count: number;
  geometry_fingerprint: string;
}

export type RstlContractMismatchCode =
  | "system_mismatch"
  | "atlas_version_mismatch"
  | "topology_id_mismatch"
  | "topology_version_mismatch"
  | "provenance_mismatch"
  | "validation_state_mismatch"
  | "line_count_mismatch"
  | "point_count_mismatch"
  | "geometry_fingerprint_mismatch";

export interface RstlContractComparison {
  compatible: boolean;
  mismatch_codes: RstlContractMismatchCode[];
}

interface AtlasLineLike {
  name?: unknown;
  region?: unknown;
  points?: unknown;
  disableRuntimeExpansion?: unknown;
  postExpansionOffsetsFaceRatioSparse?: unknown;
}

interface AtlasLike {
  system?: unknown;
  version?: unknown;
  atlasVersion?: unknown;
  topologyId?: unknown;
  topologyVersion?: unknown;
  provenance?: unknown;
  validated?: unknown;
  lines?: unknown;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function normalizedLines(lines: unknown): AtlasLineLike[] {
  if (!Array.isArray(lines)) return [];
  return lines.map((line) => {
    const value = line && typeof line === "object" ? line as AtlasLineLike : {};
    return {
      name: stringValue(value.name, ""),
      region: stringValue(value.region, ""),
      points: Array.isArray(value.points) ? value.points : [],
      disableRuntimeExpansion: value.disableRuntimeExpansion === true,
      postExpansionOffsetsFaceRatioSparse: Array.isArray(value.postExpansionOffsetsFaceRatioSparse)
        ? value.postExpansionOffsetsFaceRatioSparse
        : [],
    };
  });
}

function fingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a32:${hash.toString(16).padStart(8, "0")}`;
}

export function buildRstlSourceContract(
  atlas: unknown,
  {
    provenance,
    topologyId,
    topologyVersion,
  }: {
    provenance?: string;
    topologyId?: string;
    topologyVersion?: string;
  } = {},
): RstlSourceContract {
  const payload = atlas && typeof atlas === "object" ? atlas as AtlasLike : {};
  const lines = normalizedLines(payload.lines);
  return {
    schema_version: RSTL_SOURCE_CONTRACT_SCHEMA,
    system: stringValue(payload.system, "rstl"),
    atlas_version: stringValue(payload.atlasVersion ?? payload.version, "unknown"),
    topology_id: stringValue(payload.topologyId, topologyId || TOPOLOGY_ID),
    topology_version: stringValue(payload.topologyVersion, topologyVersion || TOPOLOGY_VERSION),
    provenance: stringValue(payload.provenance, provenance || "unknown"),
    validated: payload.validated === true,
    line_count: lines.length,
    point_count: lines.reduce((total, line) => total + (Array.isArray(line.points) ? line.points.length : 0), 0),
    geometry_fingerprint: fingerprint(lines),
  };
}

export function compareRstlSourceContracts(
  left: RstlSourceContract,
  right: RstlSourceContract,
): RstlContractComparison {
  const mismatches: RstlContractMismatchCode[] = [];
  if (left.system !== right.system) mismatches.push("system_mismatch");
  if (left.atlas_version !== right.atlas_version) mismatches.push("atlas_version_mismatch");
  if (left.topology_id !== right.topology_id) mismatches.push("topology_id_mismatch");
  if (left.topology_version !== right.topology_version) mismatches.push("topology_version_mismatch");
  if (left.provenance !== right.provenance) mismatches.push("provenance_mismatch");
  if (left.validated !== right.validated) mismatches.push("validation_state_mismatch");
  if (left.line_count !== right.line_count) mismatches.push("line_count_mismatch");
  if (left.point_count !== right.point_count) mismatches.push("point_count_mismatch");
  if (left.geometry_fingerprint !== right.geometry_fingerprint) mismatches.push("geometry_fingerprint_mismatch");
  return { compatible: mismatches.length === 0, mismatch_codes: mismatches };
}
