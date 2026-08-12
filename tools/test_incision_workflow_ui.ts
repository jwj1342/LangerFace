// Static UI contract checks for the deterministic incision workflow workbench.
import fs from "node:fs";
import assert from "node:assert/strict";

const compatibilityHtml = fs.readFileSync("incision_workflow.html", "utf8");
const legacyAgenticCompatibilityHtml = fs.readFileSync("incision_agent.html", "utf8");
function normalizeTsxContracts(source) {
  return source.replace(/id:\s*"([^"]+)"/g, 'id="$1"');
}

const html = normalizeTsxContracts([
  fs.readFileSync("src/routes/IncisionWorkbench.tsx", "utf8"),
  fs.readFileSync("src/components/IncisionStatePanel.tsx", "utf8"),
  fs.readFileSync("src/components/IncisionStagePanel.tsx", "utf8"),
  fs.readFileSync("src/components/TumorInputPanel.tsx", "utf8"),
  fs.readFileSync("src/components/SecondaryCuePanel.tsx", "utf8"),
  fs.readFileSync("src/components/CandidateResultPanel.tsx", "utf8"),
  fs.readFileSync("src/components/EditControlsPanel.tsx", "utf8"),
  fs.readFileSync("src/components/ReviewControlsPanel.tsx", "utf8"),
  fs.readFileSync("src/components/CandidateLibraryPanel.tsx", "utf8"),
  fs.readFileSync("src/components/PrivacyAuditPanel.tsx", "utf8"),
].join("\n"));
const js = [
  fs.readFileSync("src/services/incisionRuntime.ts", "utf8"),
  fs.readFileSync("src/services/incisionPresenter.ts", "utf8"),
].join("\n");
const clinicalCopy = fs.readFileSync("src/services/incisionClinicalCopy.ts", "utf8");
const reviewPolicy = fs.readFileSync("src/services/incisionReviewPolicy.ts", "utf8");
const atlasSource = fs.readFileSync("src/services/incisionAtlasSource.ts", "utf8");
const tools = [
  fs.readFileSync("src/services/incisionToolRules.ts", "utf8"),
  fs.readFileSync("src/services/incisionToolCore.ts", "utf8"),
  fs.readFileSync("src/services/incisionCandidateTools.ts", "utf8"),
  fs.readFileSync("src/services/incisionWorkflowTools.ts", "utf8"),
].join("\n");
const exportPrivacy = fs.readFileSync("src/services/exportPrivacy.ts", "utf8");
const photoRuntime = fs.readFileSync("src/services/incisionPhotoRuntime.ts", "utf8");
const controlledMarkerDetection = fs.readFileSync("src/services/controlledMarkerDetection.ts", "utf8");
const tumorInputService = fs.readFileSync("src/services/tumorInput.ts", "utf8");
const workspaceSessionService = fs.readFileSync("src/services/incisionWorkspaceSession.ts", "utf8");
const incisionSnapshotsService = fs.readFileSync("src/services/incisionSnapshots.ts", "utf8");
const incisionReviewRecordsService = fs.readFileSync("src/services/incisionReviewRecords.ts", "utf8");
const controllerSnapshotSchemas = fs.readFileSync("src/lib/controllerSnapshotSchemas.ts", "utf8");

assert.ok(compatibilityHtml.includes("/app/incision"), "legacy incision HTML redirects to the React incision route");
assert.ok(!compatibilityHtml.includes("incision_workflow_main.js"), "legacy incision HTML no longer mounts the incision controller directly");
assert.ok(
  legacyAgenticCompatibilityHtml.includes("/app/incision"),
  "retired incision_agent.html links continue to redirect to the deterministic workflow",
);
assert.ok(
  !legacyAgenticCompatibilityHtml.includes("incision_agent_main.js"),
  "retired incision_agent.html never mounts the deleted Agentic runtime",
);
assert.ok(html.includes('id="boundaryStatus"'), "workbench exposes tumor boundary status");
assert.ok(html.includes('id="anatomyPreview"'), "workbench exposes live anatomy preview for selected tumor center");
assert.ok(html.includes('id="exportTumorBtn"'), "workbench exposes tumor export button");
assert.ok(html.includes('id="importTumorBtn"'), "workbench exposes tumor import button");
assert.ok(html.includes('id="tumorImportFile"'), "workbench exposes hidden tumor import file input");
assert.ok(html.includes('id="controlledMarkerDetectBtn"'), "photo workbench exposes seeded controlled-marker detection");
assert.ok(html.includes('id="controlledMarkerConfirmBtn"'), "photo workbench requires a separate marker confirmation action");
assert.ok(html.includes('id="secondaryCueState"'), "workbench exposes secondary cue status");
assert.ok(html.includes('id="importSecondaryCueBtn"'), "workbench exposes secondary cue import action");
assert.ok(html.includes('id="secondaryCueImportFile"'), "workbench exposes hidden secondary cue import file input");
assert.ok(html.includes('id="secondaryCueConfirmed"'), "workbench captures manual secondary cue confirmation");
assert.ok(html.includes("低置信度线索"), "workbench labels secondary cues as low confidence");
assert.ok(html.includes('id="reviewerName"'), "workbench captures clinician reviewer identity");
assert.ok(html.includes('id="reviewDecision"'), "workbench exposes clinician review decision");
assert.ok(html.includes('id="reviewNotes"'), "workbench exposes clinician review notes");
assert.ok(!html.includes('id="testProviderBtn"'), "workbench exposes no remote model connectivity test");
assert.ok(!html.includes('id="providerTestState"'), "workbench exposes no remote model status");
assert.ok(!html.includes("高级：规划后端接口"), "workbench removes the Python planning backend endpoint");
assert.ok(!html.includes('id="useAgentServer"'), "workbench does not expose backend Agent orchestration");
assert.ok(!html.includes('value="/api/agentic-incision"'), "workbench does not point static previews at a missing backend route");
assert.ok(html.includes("本地确定性 workflow"), "workbench explains candidate generation is browser-side");
assert.ok(html.includes('id="guardrailDetails"'), "workbench exposes guardrail detail feedback");
assert.ok(html.includes('id="directionSource"'), "workbench exposes direction source explanation");
assert.ok(
  clinicalCopy.includes("RSTL 图谱记录无有效方向支持"),
  "workbench explains a non-empty atlas with no valid direction samples",
);
assert.ok(html.includes('id="workflowGate"'), "workbench exposes agent trace gate feedback");
assert.ok(html.includes('id="undoEditBtn"'), "workbench exposes clinician edit undo");
assert.ok(html.includes('id="redoEditBtn"'), "workbench exposes clinician edit redo");
assert.ok(html.includes('id="editHistoryState"'), "workbench exposes clinician edit history status");
assert.ok(!html.includes('id="agentExecutionList"'), "workbench keeps Agent execution events out of the sidebar");
assert.ok(!html.includes('id="agentPlanList"'), "workbench keeps 工作流计划 plan details out of the sidebar");
assert.ok(!html.includes('id="traceList"'), "workbench keeps workflow trace details out of the sidebar");
assert.ok(!html.includes("工具调用轨迹"), "workbench does not render a sidebar trace dump");
assert.ok(html.includes('id="workflowComparison"'), "workbench exposes browser workflow candidate comparison");
assert.ok(html.includes("snapshot?.headAsset.statusLabel"), "workbench stage shows the active head asset status");
assert.ok(html.includes('label="RSTL 来源"'), "workbench state panel exposes the active RSTL source");
assert.ok(html.includes('label="模型版本"'), "workbench state panel exposes the active model version without topology jargon");
assert.ok(!html.includes('id="approveCandidateBtn"'), "workbench removes duplicate candidate approval action");
assert.ok(!html.includes('id="rejectCandidateBtn"'), "workbench removes duplicate candidate rejection action");
assert.ok(html.includes("保存所选审阅状态"), "workbench saves the selected review state with one clear action");
assert.ok(html.includes('id="candidateWidth"'), "workbench exposes fusiform width and ratio metric");
assert.ok(html.includes('id="candidateTipAngle"'), "workbench exposes fusiform tip angle metric");
assert.ok(html.includes('id="candidateRstlDeviation"'), "workbench exposes RSTL direction-deviation metric");
assert.ok(html.includes('label="RSTL 角度偏差"'), "workbench labels RSTL direction deviation distinctly from tip-angle error");
assert.ok(html.includes('id="tipAngleDeg"'), "workbench exposes clinician-adjustable fusiform tip angle");
assert.ok(html.includes('id="tipAngleWrap"'), "workbench scopes the tip-angle control to fusiform candidates");
assert.ok(js.includes("exportTumorJson"), "workbench implements tumor JSON export");
assert.ok(js.includes("importTumorFile"), "workbench implements tumor JSON import");
assert.ok(js.includes("applyImportedTumor"), "workbench applies imported tumor payloads");
assert.ok(tumorInputService.includes("buildTumorInput"), "shared tumor input service owns TumorInput construction");
assert.ok(tumorInputService.includes("buildTumorFormSnapshot"), "shared tumor input service owns tumor snapshot normalization");
assert.ok(tumorInputService.includes("importedTumorFormState"), "shared tumor input service owns imported tumor form normalization");
assert.ok(js.includes("./tumorInput"), "workbench consumes the shared typed tumor input service");
assert.ok(js.includes("importedTumorFormState(payload"), "workbench delegates imported tumor payloads to the shared service");
assert.ok(js.includes("applyTumorContext(rec.tumor)"), "loading a saved candidate restores its complete tumor context");
assert.ok(js.includes("reviewForCandidateRecord"), "every candidate record uses the shared review gate");
assert.ok(js.includes("forceDraft: !readiness.ok"), "invalid confirmation saves are explicitly downgraded to drafts");
assert.ok(js.includes("shouldClearFreehandBoundaryOnLesionRepick"), "lesion repicks clear stale freehand boundaries");
assert.ok(js.includes("resetIncisionBoundaryState"), "tumor kind changes clear incompatible boundary state");
assert.ok(
  js.includes("resetBoundaryForTumorKind: () =>")
    && js.includes('els.startBoundary.textContent = "开始轮廓"'),
  "tumor kind changes reset both boundary geometry and drawing controls",
);
assert.ok(
  js.includes("pointToSurfaceRef(tumor.center, S.verts, S.tris)"),
  "imported tumor centers retain their exact surface reference instead of snapping to a vertex",
);
assert.ok(photoRuntime.includes("shouldClearFreehandBoundaryOnLesionRepick"), "photo lesion repicks use the shared boundary reset policy");
assert.ok(photoRuntime.includes("state.boundaryPoints = []") && photoRuntime.includes("state.boundaryRefs = []"),
  "photo lesion repicks clear stale freehand points and surface references");
assert.ok(photoRuntime.includes("normalizeLesionDetectionAdapter"), "controlled marker results enter the shared lesion adapter");
assert.ok(photoRuntime.includes("confirmed.eligible_for_candidate"), "invalid confirmed marker inputs cannot generate candidates");
assert.ok(photoRuntime.includes("state.result?.candidate_display_blocked"),
  "photo planning hides endpoint handles when every candidate has an engineering hard block");
assert.ok(controlledMarkerDetection.includes("network_request_made: false"), "controlled marker detection records local-only execution");
assert.ok(workspaceSessionService.includes("incision-workspace-session/v1"), "route round trips persist a versioned incision workspace session");
assert.ok(js.includes("restoreWorkspaceSession"), "the incision runtime restores the logical workspace after remount");
assert.ok(js.includes("workflowRequestId"), "stale asynchronous workflow results cannot replace a newer tumor context");
assert.ok(incisionSnapshotsService.includes("buildIncisionControllerSnapshot"), "shared incision snapshot service owns React snapshot construction");
assert.ok(incisionSnapshotsService.includes("buildIncisionSavedCandidateSummaries"), "shared incision snapshot service owns saved candidate summaries");
assert.ok(incisionSnapshotsService.includes("IncisionPlanResultLike"), "shared incision snapshot service types candidate result inputs");
assert.ok(incisionSnapshotsService.includes("IncisionSavedCandidateRecordLike"), "shared incision snapshot service types saved candidate record inputs");
assert.ok(!incisionSnapshotsService.includes("result: any"), "shared incision snapshot service does not accept untyped candidate results");
assert.ok(!incisionSnapshotsService.includes("records?: any[]"), "shared incision snapshot service does not accept untyped saved candidate records");
assert.ok(incisionSnapshotsService.includes("../lib/controllerSnapshotSchemas"), "shared incision snapshot service reuses the lightweight React snapshot schema module");
assert.ok(controllerSnapshotSchemas.includes("react-incision-controller-snapshot/v0.2"), "shared snapshot schema distinguishes the workflow-only incision state shape");
assert.ok(js.includes("./incisionSnapshots"), "workbench consumes the shared typed incision snapshot service");
assert.ok(js.includes("buildIncisionControllerSnapshot({"), "workbench delegates React snapshot payloads to the shared service");
assert.ok(js.includes('from "./exportPrivacy"'), "workbench imports browser export privacy preflight from the typed service");
assert.ok(exportPrivacy.includes("browser-export-privacy-preflight/v0.1"), "browser export preflight has a schema");
assert.ok(js.includes("exportPreflightPasses(payload"), "JSON exports run browser privacy preflight");
assert.ok(js.includes("导出隐私预检未通过"), "browser preflight blocks unsafe exports with feedback");
assert.ok(exportPrivacy.includes("raw_media_flag_true"), "browser preflight catches raw media flags");
assert.ok(exportPrivacy.includes("secret_value_present"), "browser preflight catches unredacted secrets");
assert.ok(exportPrivacy.includes("pii_pattern_present"), "browser preflight catches direct PII patterns");
assert.ok(exportPrivacy.includes("isAllowedMetadataTimestamp"), "browser preflight only exempts contract-defined metadata timestamps");
assert.ok(js.includes("summarizeTumorBoundary"), "workbench renders deterministic boundary summaries");
assert.ok(tools.includes("units_per_mm"), "tumor boundary summary exports coordinate-to-mm scale for audit");
assert.ok(tools.includes("summary_axis"), "tumor boundary summary exports summary axis for audit");
assert.ok(tools.includes("summary_normal"), "tumor boundary summary exports summary normal for audit");
assert.ok(js.includes("summarizeTumorInputQuality"), "workbench renders tumor input quality summaries");
assert.ok(js.includes("loadMediaPipeIncisionAssets"), "workbench uses a fixed MediaPipe incision surface");
assert.ok(js.includes("dataSource.takePreviewAtlas()"), "workbench consumes the staged personalized RSTL atlas");
assert.ok(js.includes("resolveIncisionAtlas"), "workbench resolves personalized RSTL before the standard fallback");
assert.ok(atlasSource.includes('mode: "mediapipe_personalized"'), "personalized MediaPipe RSTL is the primary incision input");
assert.ok(atlasSource.includes('mode: "mediapipe_standard"'), "standard MediaPipe RSTL remains an explicit fallback");
assert.ok(!js.includes("mediaPipeAtlasToFlamePreviewAtlas"), "incision runtime does not convert RSTL onto FLAME");
assert.ok(!js.includes("loadFlameBasisAsset"), "incision runtime does not load FLAME assets");
assert.ok(!reviewPolicy.includes("active_head_topology_not_supported_by_mediapipe_live_overlay"), "review policy has no obsolete FLAME overlay branch");
assert.ok(incisionReviewRecordsService.includes("head_asset: headAsset"), "review records include head asset provenance");
assert.ok(js.includes("classifyRegion(S.verts[S.lesion]"), "workbench derives anatomy preview from selected tumor center");
assert.ok(js.includes("当前点位分区"), "workbench labels live anatomy preview in Chinese");
assert.ok(js.includes("updateAnatomyPreview"), "workbench refreshes anatomy preview when the selected point changes");
assert.ok(js.includes("tumorQualityFor"), "workbench keeps tumor quality in review exports");
assert.ok(incisionReviewRecordsService.includes("tumor_boundary_summary"), "review records include tumor boundary summary geometry");
assert.ok(js.includes("boundarySummaryFor(result.tumor, result)"), "review records summarize tumor boundary against the saved candidate axis");
assert.ok(incisionReviewRecordsService.includes("肿物输入提示"), "markdown report includes tumor input quality warnings");
assert.ok(incisionReviewRecordsService.includes("肿物边界摘要"), "markdown report includes tumor boundary summary");
assert.ok(incisionReviewRecordsService.includes("梭形包络"), "markdown report includes fusiform outline and boundary envelope metrics");
assert.ok(js.includes("normalizeSecondaryCuePayload"), "workbench normalizes secondary cue imports");
assert.ok(incisionReviewRecordsService.includes("secondary_cues"), "review exports include secondary cue summaries");
assert.ok(js.includes("used_for_geometry: false"), "secondary cues never drive geometry");
assert.ok(js.includes("辅助线索仅随审阅导出，不参与几何"), "privacy copy keeps secondary cues out of geometry");
assert.ok(js.includes("tip_angle_error_deg"), "workbench renders fusiform tip angle error");
assert.ok(js.includes("rstl_deviation_deg"), "workbench renders the candidate RSTL direction deviation");
assert.ok(js.includes('typeof rstlDeviation === "number"'), "missing or null RSTL deviation is not rendered as a false 0°");
assert.ok(incisionSnapshotsService.includes("rstlDeviation"), "controller snapshot preserves the visible RSTL direction deviation");
assert.ok(incisionReviewRecordsService.includes("incision-review-record/v0.4"), "review records use explicit review workflow schema");
assert.ok(js.includes("approved_for_discussion"), "review records support clinician approval");
assert.ok(js.includes("rejected_by_clinician"), "review records support clinician rejection");
assert.ok(incisionReviewRecordsService.includes("audit_events"), "review records include audit events");
assert.ok(incisionReviewRecordsService.includes("guardrail_summary"), "review records include guardrail summary");
assert.ok(incisionReviewRecordsService.includes("review_gate"), "review records include review gate state");
assert.ok(incisionReviewRecordsService.includes("candidate_edit_session"), "review records include clinician edit session state");
assert.ok(incisionReviewRecordsService.includes("tip_angle_deg: entry.tip_angle_deg"), "review records retain tip-angle edit provenance");
assert.ok(incisionReviewRecordsService.includes("candidate-edit-session/v0.1"), "clinician edit session has an explicit schema");
assert.ok(js.includes("undoEditSnapshot"), "workbench implements clinician edit undo");
assert.ok(js.includes("redoEditSnapshot"), "workbench implements clinician edit redo");
assert.ok(js.includes("commitEditSnapshot(\"endpoint_drag\")"), "endpoint dragging commits provenance history");
assert.ok(incisionReviewRecordsService.includes("workflow_trace_gate"), "review records include deterministic workflow trace gate state");
assert.ok(incisionReviewRecordsService.includes("sensitive_structure_inspection"), "review records include sensitive structure inspection");
assert.ok(incisionReviewRecordsService.includes("workflow_plan_audit"), "review records include 工作流计划 plan state");
assert.ok(incisionReviewRecordsService.includes("workflow_execution_events"), "review records include deterministic workflow execution events");
assert.ok(js.includes("logWorkflowTraceToConsole"), "workbench logs workflow trace details to DevTools console");
assert.ok(js.includes("console.groupCollapsed"), "workflow trace uses a collapsed console group");
assert.ok(js.includes("console.table"), "workflow trace emits a console table summary");
assert.ok(js.includes("observed_actions"), "workflow plan UI shows observed tool actions");
assert.ok(tools.includes("trace_indexes"), "workflow plan keeps linked trace indexes in export/console data");
assert.ok(tools.includes("incision-workflow-trace-gate/v0.1"), "workflow trace gate has an explicit schema");
assert.ok(tools.includes("WORKFLOW_TRACE_GATE_REQUIRED"), "browser tools define required workflow actions");
assert.ok(tools.includes("summarize_tumor_input_quality"), "workflow gate requires tumor input quality tool");
assert.ok(tools.includes("inspect_sensitive_structures"), "workflow gate requires sensitive structure inspection tool");
assert.ok(tools.includes("linear_subcutaneous_incision"), "workflow gate accepts linear incision generation tool");
assert.ok(tools.includes("fusiform_cutaneous_incision"), "workflow gate accepts fusiform incision generation tool");
assert.ok(tools.includes("preview_incision_on_face"), "workflow gate requires deterministic face preview before review");
assert.ok(reviewPolicy.includes("工作流工具 trace 未通过门控"), "approval is blocked when workflow trace gate fails");
assert.ok(incisionReviewRecordsService.includes("工作流工具门控"), "markdown report includes workflow trace gate status");
assert.ok(incisionReviewRecordsService.includes("工作流计划："), "markdown report includes workflow plan status");
assert.ok(incisionReviewRecordsService.includes("candidate_comparison"), "review export includes candidate comparison");
assert.ok(incisionReviewRecordsService.includes("candidate_alternatives"), "review export includes browser workflow candidate alternatives");
assert.ok(incisionReviewRecordsService.includes("workflow_audit"), "review export includes browser workflow orchestration audit");
assert.ok(js.includes("buildWorkflowComparisonPresentation"), "workbench renders browser workflow candidate comparison");
assert.ok(js.includes("workflowAlternativeResult"), "workbench can save browser workflow alternatives as review records");
assert.ok(js.includes("alternative.sensitive_structure_inspection"), "saved browser alternatives keep sensitive inspection");
assert.ok(js.includes("已保存 ${workflowAlternatives.length} 个浏览器方向备选"), "variant save action prefers browser workflow alternatives");
assert.ok(js.includes("formatRecoveredFailureSummary"), "workbench formats recovered tool failures");
assert.ok(incisionReviewRecordsService.includes("工作流恢复详情"), "markdown report includes recovered failure details");
assert.ok(incisionReviewRecordsService.includes("已跳过失败变体并继续比较"), "recovered failure summary explains candidate skip behavior");
assert.ok(incisionReviewRecordsService.includes("不是临床推荐或手术指令"), "candidate comparison warns it is not clinical recommendation");
assert.ok(js.includes("reviewReadiness"), "review workflow validates approval readiness");
assert.ok(reviewPolicy.includes("summarizeGuardrails(result.guardrails).high_count"), "review workflow detects high guardrail warnings");
assert.ok(reviewPolicy.includes("live_overlay_ready"), "review gate records live overlay readiness");
assert.ok(!js.includes("testProviderConnection"), "workbench contains no remote model connectivity runtime");
assert.ok(!js.includes("normalizeProviderBaseUrl"), "workbench contains no provider URL handling");
assert.ok(!js.includes("stream: true"), "workbench does not request streaming model output");
assert.ok(!js.includes('event === "trace_gate"'), "workbench does not consume trace gate SSE events");
assert.ok(!js.includes('event === "execution_event"'), "workbench does not consume execution SSE events");
assert.ok(!js.includes('event === "react_plan"'), "workbench does not consume model planning events");
assert.ok(incisionReviewRecordsService.includes("工作流执行事件"), "markdown report includes workflow execution event status");
assert.ok(js.includes("完整 workflow trace 已写入 DevTools Console"), "sidebar points reviewers to console for full workflow trace");
assert.ok(js.includes("浏览器确定性 workflow 已更新候选"), "workbench reports browser workflow updates");
assert.ok(js.includes("const requestId = ++S.workflowRequestId"),
  "workflow requests receive monotonically increasing ids");
assert.ok(js.includes("if (requestId !== S.workflowRequestId) return"),
  "stale automatic previews cannot overwrite a newer explicit generation");
assert.ok(js.includes("S.activeExplicitWorkflowCount += 1"),
  "automatic previews do not lock the explicit generation button");
assert.ok(incisionReviewRecordsService.includes("建议覆盖项"), "markdown report includes suggested override details");
assert.ok(js.includes("protective_direction"), "workbench displays protective direction guardrail suggestions");
assert.ok(js.includes("directionSourceLabel"), "workbench labels RSTL direction source");
assert.ok(js.includes("const center = candidate.center || S.result.tumor.center"), "endpoint dragging keeps the incision center anchored near the tumor");
assert.ok(js.includes("if (!S.head || !els.wrap) return"), "ResizeObserver cannot call resize before the 3D head is initialized");
assert.ok(js.includes("皱襞/边界辅助线索：只读审阅，不参与几何"), "workbench explains secondary cues do not drive direction geometry");
assert.ok(js.includes("医生人工覆盖已记录"), "workbench exposes manual direction override state");
assert.ok(incisionReviewRecordsService.includes("RSTL 来源"), "markdown report includes direction source provenance");
assert.ok(incisionReviewRecordsService.includes("最近敏感游离缘"), "markdown report includes sensitive free-margin distance");
assert.ok(incisionReviewRecordsService.includes("候选版本"), "markdown report includes candidate version provenance");
assert.ok(js.includes("发送到实时叠加前，请先确认当前候选草案"), "live overlay requires candidate approval");
assert.ok(js.includes('window.location.assign("/live?incisionOverlay=staged")'), "successful overlay handoff navigates to the live workbench");
assert.ok(js.includes("atlas.lines || []"), "incision stage renders the complete bilateral RSTL atlas");
assert.ok(!js.includes("i % 2 === 0"), "incision stage never drops one side through index thinning");
assert.ok(reviewPolicy.includes("当前候选有高风险保护提示"), "high-risk approval requires review notes");

console.log("test_incision_workflow_ui: tumor boundary IO and review workflow assertions passed");
