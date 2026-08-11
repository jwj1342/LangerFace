import { validateAtlas } from "./atlasContract.ts";
import { TOPOLOGY_ID, TOPOLOGY_VERSION } from "./constants.ts";
import type { AtlasPayload, PreviewAtlasPayload } from "./dataSource.ts";
import { buildRstlSourceContract, type RstlSourceContract } from "./rstlSourceContract.ts";

export type IncisionAtlasMode = "mediapipe_personalized" | "mediapipe_standard";

export interface IncisionAtlasResolution {
  atlas: AtlasPayload;
  mode: IncisionAtlasMode;
  statusLabel: string;
  warnings: string[];
  provenance: string;
  contract: RstlSourceContract;
}

type AtlasRecord = PreviewAtlasPayload & Record<string, unknown>;

export function isPersonalizedRstlAtlas(atlas: unknown): atlas is AtlasRecord {
  if (!atlas || typeof atlas !== "object") return false;
  const value = atlas as Record<string, any>;
  const provenance = String(value.provenance || "").toLowerCase();
  const source = String(value.personalization?.source || value.source || "").toLowerCase();
  const algorithm = String(value.personalization?.algorithm || value.diagnostics?.algorithm || "").toLowerCase();
  return provenance.includes("local-yolo")
    || source.includes("personalized_rstl")
    || algorithm.includes("rstl-refinement");
}

function validationIssues(atlas: unknown, triangleCount: number): string[] {
  return validateAtlas(atlas, triangleCount, {
    expectedSystem: "rstl",
    expectedVersion: null,
    expectedTopologyId: TOPOLOGY_ID,
    expectedTopologyVersion: TOPOLOGY_VERSION,
  });
}

export function resolveIncisionAtlas({
  personalizedAtlas,
  standardAtlas,
  triangleCount,
}: {
  personalizedAtlas: PreviewAtlasPayload | null;
  standardAtlas: AtlasPayload;
  triangleCount: number;
}): IncisionAtlasResolution {
  const warnings: string[] = [];
  if (personalizedAtlas) {
    const issues = validationIssues(personalizedAtlas, triangleCount);
    if (!issues.length && isPersonalizedRstlAtlas(personalizedAtlas)) {
      const provenance = String(personalizedAtlas.provenance || "personalized_rstl_yolo_v6");
      return {
        atlas: personalizedAtlas as AtlasPayload,
        mode: "mediapipe_personalized",
        statusLabel: "MediaPipe 个体化 RSTL · YOLO/V6 证据",
        warnings: ["个体化 RSTL 仍是未临床验证的研究草案；候选必须经过 guardrails 与医生确认。"],
        provenance,
        contract: buildRstlSourceContract(personalizedAtlas, { provenance }),
      };
    }
    warnings.push(issues.length
      ? `个体化 RSTL 未通过 MediaPipe 拓扑校验：${issues.join("；")}`
      : "跨页图谱不是受支持的 YOLO/V6 个体化 RSTL。",
    );
  }

  const standardIssues = validationIssues(standardAtlas, triangleCount);
  if (standardIssues.length) {
    throw new Error(`标准 RSTL 图谱校验失败：${standardIssues.join("；")}`);
  }
  warnings.push("未检测到可用的个体化 RSTL；当前明确降级为标准先验。建议先完成个性化采集再设计切口。");
  const provenance = "bundled_standard_rstl_prior";
  return {
    atlas: standardAtlas,
    mode: "mediapipe_standard",
    statusLabel: "MediaPipe 标准 RSTL · 降级模式",
    warnings,
    provenance,
    contract: buildRstlSourceContract(standardAtlas, { provenance }),
  };
}
