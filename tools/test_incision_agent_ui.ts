// Static UI contract checks for the incision agent workbench.
import fs from "node:fs";
import assert from "node:assert/strict";

const compatibilityHtml = fs.readFileSync("incision_agent.html", "utf8");
function normalizeTsxContracts(source) {
  return source.replace(/id:\s*"([^"]+)"/g, 'id="$1"');
}

const html = normalizeTsxContracts([
  fs.readFileSync("src/routes/IncisionWorkbench.tsx", "utf8"),
  fs.readFileSync("src/components/IncisionStatePanel.tsx", "utf8"),
  fs.readFileSync("src/components/IncisionStagePanel.tsx", "utf8"),
  fs.readFileSync("src/components/TumorInputPanel.tsx", "utf8"),
  fs.readFileSync("src/components/SecondaryCuePanel.tsx", "utf8"),
  fs.readFileSync("src/components/ProviderConfigPanel.tsx", "utf8"),
  fs.readFileSync("src/components/CandidateResultPanel.tsx", "utf8"),
  fs.readFileSync("src/components/EditControlsPanel.tsx", "utf8"),
  fs.readFileSync("src/components/ReviewControlsPanel.tsx", "utf8"),
  fs.readFileSync("src/components/CandidateLibraryPanel.tsx", "utf8"),
  fs.readFileSync("src/components/PrivacyAuditPanel.tsx", "utf8"),
].join("\n"));
const js = fs.readFileSync("src/services/incisionAgentRuntime.ts", "utf8");
const tools = [
  fs.readFileSync("src/services/incisionToolRules.ts", "utf8"),
  fs.readFileSync("src/services/incisionToolCore.ts", "utf8"),
  fs.readFileSync("src/services/incisionCandidateTools.ts", "utf8"),
  fs.readFileSync("src/services/incisionWorkflowTools.ts", "utf8"),
].join("\n");
const exportPrivacy = fs.readFileSync("src/services/exportPrivacy.ts", "utf8");
const providerConfig = fs.readFileSync("src/services/providerConfig.ts", "utf8");
const tumorInputService = fs.readFileSync("src/services/tumorInput.ts", "utf8");
const incisionSnapshotsService = fs.readFileSync("src/services/incisionSnapshots.ts", "utf8");
const controllerSnapshotSchemas = fs.readFileSync("src/lib/controllerSnapshotSchemas.ts", "utf8");

assert.ok(compatibilityHtml.includes("/app/incision"), "legacy incision HTML redirects to the React incision route");
assert.ok(!compatibilityHtml.includes("incision_agent_main.js"), "legacy incision HTML no longer mounts the incision controller directly");
assert.ok(html.includes('id="boundaryStatus"'), "workbench exposes tumor boundary status");
assert.ok(html.includes('id="anatomyPreview"'), "workbench exposes live anatomy preview for selected tumor center");
assert.ok(html.includes('id="exportTumorBtn"'), "workbench exposes tumor export button");
assert.ok(html.includes('id="importTumorBtn"'), "workbench exposes tumor import button");
assert.ok(html.includes('id="tumorImportFile"'), "workbench exposes hidden tumor import file input");
assert.ok(html.includes('id="secondaryCueState"'), "workbench exposes secondary cue status");
assert.ok(html.includes('id="importSecondaryCueBtn"'), "workbench exposes secondary cue import action");
assert.ok(html.includes('id="secondaryCueImportFile"'), "workbench exposes hidden secondary cue import file input");
assert.ok(html.includes('id="secondaryCueConfirmed"'), "workbench captures manual secondary cue confirmation");
assert.ok(html.includes("低置信度线索"), "workbench labels secondary cues as low confidence");
assert.ok(html.includes('id="reviewerName"'), "workbench captures clinician reviewer identity");
assert.ok(html.includes('id="reviewDecision"'), "workbench exposes clinician review decision");
assert.ok(html.includes('id="reviewNotes"'), "workbench exposes clinician review notes");
assert.ok(html.includes('id="testProviderBtn"'), "workbench exposes LLM Provider connectivity test");
assert.ok(html.includes('id="providerTestState"'), "workbench exposes LLM Provider connectivity status");
assert.ok(html.includes("clinical-developer-disclosure"), "workbench folds provider connectivity into developer settings");
assert.ok(html.includes("AI 摘要服务配置"), "workbench labels provider connectivity as AI summary service configuration");
assert.ok(!html.includes("LLM Provider</span>"), "workbench does not expose LLM Provider as a clinician-facing panel title");
assert.ok(html.includes('id="providerMode"') && html.includes('value="openai-compatible"'), "workbench fixes the only visible provider contract to OpenAI-compatible");
assert.ok(!html.includes("native provider"), "workbench does not expose a native provider choice");
assert.ok(providerConfig.includes('DEFAULT_PROVIDER_BASE_URL = "https://api.openai.com/v1"'), "workbench defaults to an HTTPS OpenAI-compatible provider URL");
assert.ok(!html.includes("高级：规划后端接口"), "workbench removes the Python planning backend endpoint");
assert.ok(!html.includes('id="useAgentServer"'), "workbench does not expose backend Agent orchestration");
assert.ok(!html.includes('value="/api/agentic-incision"'), "workbench does not point static previews at a missing backend route");
assert.ok(html.includes("浏览器内确定性 workflow"), "workbench explains candidate generation is browser-side");
assert.ok(html.includes('id="guardrailDetails"'), "workbench exposes guardrail detail feedback");
assert.ok(html.includes('id="directionSource"'), "workbench exposes direction source explanation");
assert.ok(html.includes('id="agentGate"'), "workbench exposes agent trace gate feedback");
assert.ok(html.includes('id="undoEditBtn"'), "workbench exposes clinician edit undo");
assert.ok(html.includes('id="redoEditBtn"'), "workbench exposes clinician edit redo");
assert.ok(html.includes('id="editHistoryState"'), "workbench exposes clinician edit history status");
assert.ok(!html.includes('id="agentExecutionList"'), "workbench keeps Agent execution events out of the sidebar");
assert.ok(!html.includes('id="agentPlanList"'), "workbench keeps Agent ReAct plan details out of the sidebar");
assert.ok(!html.includes('id="traceList"'), "workbench keeps workflow trace details out of the sidebar");
assert.ok(!html.includes("工具调用轨迹"), "workbench does not render a sidebar trace dump");
assert.ok(html.includes('id="agentComparison"'), "workbench exposes browser workflow candidate comparison");
assert.ok(html.includes("snapshot?.headAsset.statusLabel"), "workbench stage shows the active head asset status");
assert.ok(html.includes('label="头模"'), "workbench state panel exposes the active head asset");
assert.ok(html.includes('label="拓扑"'), "workbench state panel exposes the active topology");
assert.ok(html.includes('id="approveCandidateBtn"'), "workbench exposes candidate approval action");
assert.ok(html.includes('id="rejectCandidateBtn"'), "workbench exposes candidate rejection action");
assert.ok(html.includes('id="candidateWidth"'), "workbench exposes fusiform width and ratio metric");
assert.ok(html.includes('id="candidateTipAngle"'), "workbench exposes fusiform tip angle metric");
assert.ok(js.includes("exportTumorJson"), "workbench implements tumor JSON export");
assert.ok(js.includes("importTumorFile"), "workbench implements tumor JSON import");
assert.ok(js.includes("applyImportedTumor"), "workbench applies imported tumor payloads");
assert.ok(tumorInputService.includes("buildTumorInput"), "shared tumor input service owns TumorInput construction");
assert.ok(tumorInputService.includes("buildTumorFormSnapshot"), "shared tumor input service owns tumor snapshot normalization");
assert.ok(tumorInputService.includes("importedTumorFormState"), "shared tumor input service owns imported tumor form normalization");
assert.ok(js.includes("./tumorInput"), "workbench consumes the shared typed tumor input service");
assert.ok(js.includes("importedTumorFormState(payload"), "workbench delegates imported tumor payloads to the shared service");
assert.ok(incisionSnapshotsService.includes("buildIncisionControllerSnapshot"), "shared incision snapshot service owns React snapshot construction");
assert.ok(incisionSnapshotsService.includes("buildIncisionSavedCandidateSummaries"), "shared incision snapshot service owns saved candidate summaries");
assert.ok(incisionSnapshotsService.includes("IncisionPlanResultLike"), "shared incision snapshot service types candidate result inputs");
assert.ok(incisionSnapshotsService.includes("IncisionSavedCandidateRecordLike"), "shared incision snapshot service types saved candidate record inputs");
assert.ok(!incisionSnapshotsService.includes("result: any"), "shared incision snapshot service does not accept untyped candidate results");
assert.ok(!incisionSnapshotsService.includes("records?: any[]"), "shared incision snapshot service does not accept untyped saved candidate records");
assert.ok(incisionSnapshotsService.includes("../lib/controllerSnapshotSchemas"), "shared incision snapshot service reuses the lightweight React snapshot schema module");
assert.ok(controllerSnapshotSchemas.includes("react-incision-controller-snapshot/v0.1"), "shared snapshot schema module owns the incision React snapshot schema");
assert.ok(js.includes("./incisionSnapshots"), "workbench consumes the shared typed incision snapshot service");
assert.ok(js.includes("buildIncisionControllerSnapshot({"), "workbench delegates React snapshot payloads to the shared service");
assert.ok(js.includes('from "./exportPrivacy"'), "workbench imports browser export privacy preflight from the typed service");
assert.ok(exportPrivacy.includes("browser-export-privacy-preflight/v0.1"), "browser export preflight has a schema");
assert.ok(js.includes("exportPreflightPasses(payload"), "JSON exports run browser privacy preflight");
assert.ok(js.includes("导出隐私预检未通过"), "browser preflight blocks unsafe exports with feedback");
assert.ok(exportPrivacy.includes("raw_media_flag_true"), "browser preflight catches raw media flags");
assert.ok(exportPrivacy.includes("secret_value_present"), "browser preflight catches unredacted secrets");
assert.ok(exportPrivacy.includes("pii_pattern_present"), "browser preflight catches direct PII patterns");
assert.ok(exportPrivacy.includes('!lowerLeaf.endsWith("_at")'), "browser preflight does not flag timestamps as phone numbers");
assert.ok(js.includes("summarizeTumorBoundary"), "workbench renders deterministic boundary summaries");
assert.ok(tools.includes("units_per_mm"), "tumor boundary summary exports coordinate-to-mm scale for audit");
assert.ok(tools.includes("summary_axis"), "tumor boundary summary exports summary axis for audit");
assert.ok(tools.includes("summary_normal"), "tumor boundary summary exports summary normal for audit");
assert.ok(js.includes("summarizeTumorInputQuality"), "workbench renders tumor input quality summaries");
assert.ok(js.includes("loadPreferredIncisionAssets"), "workbench prefers FLAME head assets before falling back to MediaPipe");
assert.ok(js.includes("mediaPipeAtlasToFlamePreviewAtlas"), "workbench converts MediaPipe RSTL draft lines before rendering on FLAME");
assert.ok(js.includes("active_head_topology_not_supported_by_mediapipe_live_overlay"), "workbench blocks FLAME candidates from direct MediaPipe live overlay");
assert.ok(js.includes("head_asset: currentHeadAssetSnapshot()"), "review records include head asset provenance");
assert.ok(js.includes("classifyRegion(S.verts[S.lesion]"), "workbench derives anatomy preview from selected tumor center");
assert.ok(js.includes("当前点位分区"), "workbench labels live anatomy preview in Chinese");
assert.ok(js.includes("updateAnatomyPreview"), "workbench refreshes anatomy preview when the selected point changes");
assert.ok(js.includes("tumorQualityFor"), "workbench keeps tumor quality in review exports");
assert.ok(js.includes("tumor_boundary_summary"), "review records include tumor boundary summary geometry");
assert.ok(js.includes("boundarySummaryFor(result.tumor, result)"), "review records summarize tumor boundary against the saved candidate axis");
assert.ok(js.includes("肿物输入提示"), "markdown report includes tumor input quality warnings");
assert.ok(js.includes("肿物边界摘要"), "markdown report includes tumor boundary summary");
assert.ok(js.includes("梭形包络"), "markdown report includes fusiform outline and boundary envelope metrics");
assert.ok(js.includes("normalizeSecondaryCuePayload"), "workbench normalizes secondary cue imports");
assert.ok(js.includes("secondary_cues"), "review exports include secondary cue summaries");
assert.ok(js.includes("used_for_geometry: false"), "secondary cues never drive geometry");
assert.ok(js.includes("used_for_agent_prompt: false"), "secondary cues are not sent to the agent prompt");
assert.ok(js.includes("辅助线索仅随审阅导出，不参与几何"), "privacy copy keeps secondary cues out of geometry");
assert.ok(js.includes("tip_angle_error_deg"), "workbench renders fusiform tip angle error");
assert.ok(js.includes("incision-review-record/v0.3"), "review records use explicit review workflow schema");
assert.ok(js.includes("approved_for_discussion"), "review records support clinician approval");
assert.ok(js.includes("rejected_by_clinician"), "review records support clinician rejection");
assert.ok(js.includes("audit_events"), "review records include audit events");
assert.ok(js.includes("guardrail_summary"), "review records include guardrail summary");
assert.ok(js.includes("review_gate"), "review records include review gate state");
assert.ok(js.includes("candidate_edit_session"), "review records include clinician edit session state");
assert.ok(js.includes("candidate-edit-session/v0.1"), "clinician edit session has an explicit schema");
assert.ok(js.includes("undoEditSnapshot"), "workbench implements clinician edit undo");
assert.ok(js.includes("redoEditSnapshot"), "workbench implements clinician edit redo");
assert.ok(js.includes("commitEditSnapshot(\"endpoint_drag\")"), "endpoint dragging commits provenance history");
assert.ok(js.includes("agent_trace_gate"), "review records include agent trace gate state");
assert.ok(js.includes("sensitive_structure_inspection"), "review records include sensitive structure inspection");
assert.ok(js.includes("agent_react_plan"), "review records include Agent ReAct plan state");
assert.ok(js.includes("agent_execution_events"), "review records include Agent execution events");
assert.ok(js.includes("logWorkflowTraceToConsole"), "workbench logs workflow trace details to DevTools console");
assert.ok(js.includes("console.groupCollapsed"), "workflow trace uses a collapsed console group");
assert.ok(js.includes("console.table"), "workflow trace emits a console table summary");
assert.ok(js.includes("observed_actions"), "ReAct plan UI shows observed tool actions");
assert.ok(tools.includes("trace_indexes"), "ReAct plan keeps linked trace indexes in export/console data");
assert.ok(tools.includes("agent-trace-gate/v0.1"), "agent trace gate has an explicit schema");
assert.ok(tools.includes("AGENT_TRACE_GATE_REQUIRED"), "browser tools define required agent tool actions");
assert.ok(tools.includes("summarize_tumor_input_quality"), "agent gate requires tumor input quality tool");
assert.ok(tools.includes("inspect_sensitive_structures"), "agent gate requires sensitive structure inspection tool");
assert.ok(tools.includes("linear_subcutaneous_incision"), "agent gate accepts linear incision generation tool");
assert.ok(tools.includes("fusiform_cutaneous_incision"), "agent gate accepts fusiform incision generation tool");
assert.ok(tools.includes("preview_incision_on_face"), "agent gate requires deterministic face preview before review");
assert.ok(js.includes("Agent 工具 trace 未通过门控"), "approval is blocked when agent trace gate fails");
assert.ok(js.includes("Agent 工具门控"), "markdown report includes agent trace gate status");
assert.ok(js.includes("Agent ReAct 计划"), "markdown report includes Agent ReAct plan status");
assert.ok(js.includes("candidate_comparison"), "review export includes candidate comparison");
assert.ok(js.includes("candidate_alternatives"), "review export includes browser workflow candidate alternatives");
assert.ok(js.includes("agent_orchestration_audit"), "review export includes browser workflow orchestration audit");
assert.ok(js.includes("renderAgentComparison"), "workbench renders browser workflow candidate comparison");
assert.ok(js.includes("workflowAlternativeResult"), "workbench can save browser workflow alternatives as review records");
assert.ok(js.includes("alternative.sensitive_structure_inspection"), "saved browser alternatives keep sensitive inspection");
assert.ok(js.includes("已保存 ${workflowAlternatives.length} 个浏览器方向备选"), "variant save action prefers browser workflow alternatives");
assert.ok(js.includes("formatRecoveredFailureSummary"), "workbench formats recovered tool failures");
assert.ok(js.includes("Agent 恢复详情"), "markdown report includes recovered failure details");
assert.ok(js.includes("已跳过失败变体并继续比较"), "recovered failure summary explains candidate skip behavior");
assert.ok(js.includes("不是临床推荐或手术指令"), "candidate comparison warns it is not clinical recommendation");
assert.ok(js.includes("reviewReadiness"), "review workflow validates approval readiness");
assert.ok(js.includes("highGuardrailWarnings"), "review workflow detects high guardrail warnings");
assert.ok(js.includes("live_overlay_ready"), "review gate records live overlay readiness");
assert.ok(js.includes("testProviderConnection"), "workbench can test OpenAI-compatible provider connectivity without generating a candidate");
assert.ok(js.includes("normalizeProviderBaseUrl"), "workbench normalizes host:port provider input before fetch");
assert.ok(js.includes("Provider 连接失败"), "workbench reports direct LLM Provider connectivity failures");
assert.ok(js.includes("localProviderFromRemotePageMessage"), "workbench warns remote pages before direct localhost provider tests");
assert.ok(js.includes("insecureProviderFromSecurePageMessage"), "workbench warns HTTPS previews before HTTP private provider tests");
assert.ok(providerConfig.includes("Mixed Content/Private Network"), "shared provider config explains mixed-content private-network blocking");
assert.ok(providerConfig.includes("继续发送测试请求"), "shared provider config keeps the direct provider test request warning");
assert.ok(js.includes("仍将发送测试请求"), "workbench still sends provider test requests so DevTools can show the real network result");
assert.ok(!js.includes("handleAgentStreamEvent"), "workbench does not consume Python Agent SSE trace events");
assert.ok(!js.includes("stream: true"), "workbench no longer requests streaming agent trace");
assert.ok(!js.includes('event === "trace_gate"'), "workbench does not consume trace gate SSE events");
assert.ok(!js.includes('event === "execution_event"'), "workbench does not consume execution SSE events");
assert.ok(!js.includes('event === "react_plan"'), "workbench does not consume ReAct plan SSE events");
assert.ok(js.includes("Agent 执行事件"), "markdown report includes Agent execution event status");
assert.ok(js.includes("完整 workflow trace 已写入 DevTools Console"), "sidebar points reviewers to console for full workflow trace");
assert.ok(js.includes("浏览器确定性 workflow 已更新候选"), "workbench reports browser workflow updates");
assert.ok(!js.includes("agentFallbackMessage"), "workbench does not keep Python Agent fallback messaging");
assert.ok(js.includes("建议覆盖项"), "markdown report includes suggested override details");
assert.ok(js.includes("protective_direction"), "workbench displays protective direction guardrail suggestions");
assert.ok(js.includes("directionSourceLabel"), "workbench labels RSTL direction source");
assert.ok(js.includes("const center = candidate.center || S.result.tumor.center"), "endpoint dragging keeps the incision center anchored near the tumor");
assert.ok(js.includes("if (!S.head || !els.wrap) return"), "ResizeObserver cannot call resize before the 3D head is initialized");
assert.ok(js.includes("皱襞/边界辅助线索：只读审阅，不参与几何"), "workbench explains secondary cues do not drive direction geometry");
assert.ok(js.includes("医生人工覆盖已记录"), "workbench exposes manual direction override state");
assert.ok(js.includes("RSTL 来源"), "markdown report includes direction source provenance");
assert.ok(js.includes("最近敏感游离缘"), "markdown report includes sensitive free-margin distance");
assert.ok(js.includes("候选版本"), "markdown report includes candidate version provenance");
assert.ok(js.includes("发送到实时叠加前，请先确认当前候选草案"), "live overlay requires candidate approval");
assert.ok(js.includes("当前候选有高风险 guardrail"), "high-risk approval requires review notes");

console.log("test_incision_agent_ui: tumor boundary IO and review workflow assertions passed");
