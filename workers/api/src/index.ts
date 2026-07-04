import { createCase, getCaseSummary, saveAnnotation, saveCandidate, saveReview, saveTumor, updateCase } from "./db";
import { errorResponse, jsonResponse, optionsResponse, readJsonBody } from "./http";
import type { Env, RouteContext } from "./types";
import { hasPatientIdentityPayload, isHighRiskReviewMissingNote } from "./validation";

type Handler = (context: RouteContext) => Promise<Response>;

interface RouteMatch {
  handler: Handler;
  params: Record<string, string>;
}

const routes: Array<{ method: string; pattern: RegExp; handler: Handler; keys: string[] }> = [
  { method: "GET", pattern: /^\/health$/, keys: [], handler: handleHealth },
  { method: "POST", pattern: /^\/api\/cases$/, keys: [], handler: handleCreateCase },
  { method: "GET", pattern: /^\/api\/cases\/([^/]+)$/, keys: ["caseId"], handler: handleGetCase },
  { method: "PUT", pattern: /^\/api\/cases\/([^/]+)$/, keys: ["caseId"], handler: handleUpdateCase },
  { method: "POST", pattern: /^\/api\/cases\/([^/]+)\/tumors$/, keys: ["caseId"], handler: handleSaveTumor },
  { method: "POST", pattern: /^\/api\/cases\/([^/]+)\/annotations$/, keys: ["caseId"], handler: handleSaveAnnotation },
  { method: "POST", pattern: /^\/api\/cases\/([^/]+)\/incision-candidates$/, keys: ["caseId"], handler: handleSaveCandidate },
  { method: "POST", pattern: /^\/api\/incision-candidates\/([^/]+)\/review$/, keys: ["candidateId"], handler: handleSaveReview },
  { method: "GET", pattern: /^\/api\/cases\/([^/]+)\/export$/, keys: ["caseId"], handler: handleExportCase },
];

function matchRoute(method: string, pathname: string): RouteMatch | null {
  for (const route of routes) {
    if (route.method !== method) continue;
    const match = route.pattern.exec(pathname);
    if (!match) continue;
    const params: Record<string, string> = {};
    route.keys.forEach((key, index) => {
      params[key] = decodeURIComponent(match[index + 1] || "");
    });
    return { handler: route.handler, params };
  }
  return null;
}

async function handleHealth({ env, request }: RouteContext) {
  return jsonResponse(request, env, {
    ok: true,
    service: "langerface-api",
    schema: "cloudflare-worker-d1-r2/v0.1",
  });
}

async function handleCreateCase({ env, request }: RouteContext) {
  const payload = await readJsonBody(request);
  if (hasPatientIdentityPayload(payload)) {
    return errorResponse(request, env, 400, "patient_identity_payload_rejected", "Cases must use de-identified IDs and cannot include direct patient identity fields.");
  }
  return jsonResponse(request, env, await createCase(env, payload), { status: 201 });
}

async function handleGetCase({ env, params, request }: RouteContext) {
  const result = await getCaseSummary(env, params.caseId || "");
  if (!result) return errorResponse(request, env, 404, "case_not_found", "Case was not found.");
  return jsonResponse(request, env, result);
}

async function handleUpdateCase({ env, params, request }: RouteContext) {
  const payload = await readJsonBody(request);
  if (hasPatientIdentityPayload(payload)) {
    return errorResponse(request, env, 400, "patient_identity_payload_rejected", "Case updates cannot include direct patient identity fields.");
  }
  const result = await updateCase(env, params.caseId || "", payload);
  if (!result) return errorResponse(request, env, 404, "case_not_found", "Case was not found.");
  return jsonResponse(request, env, result);
}

async function handleSaveTumor({ env, params, request }: RouteContext) {
  const payload = await readJsonBody(request);
  const result = await saveTumor(env, params.caseId || "", payload);
  if (!result) return errorResponse(request, env, 404, "case_not_found", "Case was not found.");
  return jsonResponse(request, env, result, { status: 201 });
}

async function handleSaveAnnotation({ env, params, request }: RouteContext) {
  const payload = await readJsonBody(request);
  const result = await saveAnnotation(env, params.caseId || "", payload);
  if (!result) return errorResponse(request, env, 404, "case_not_found", "Case was not found.");
  return jsonResponse(request, env, result, { status: 201 });
}

async function handleSaveCandidate({ env, params, request }: RouteContext) {
  const payload = await readJsonBody(request);
  const result = await saveCandidate(env, params.caseId || "", payload);
  if (!result) return errorResponse(request, env, 404, "case_not_found", "Case was not found.");
  return jsonResponse(request, env, result, { status: 201 });
}

async function handleSaveReview({ env, params, request }: RouteContext) {
  const payload = await readJsonBody(request);
  if (isHighRiskReviewMissingNote(payload)) {
    return errorResponse(request, env, 400, "high_risk_review_note_required", "High-risk candidate approvals require notes or an override reason.");
  }
  const result = await saveReview(env, params.candidateId || "", payload);
  if (!result) return errorResponse(request, env, 404, "candidate_not_found", "Incision candidate was not found.");
  return jsonResponse(request, env, result, { status: 201 });
}

async function handleExportCase(context: RouteContext) {
  const result = await getCaseSummary(context.env, context.params.caseId || "");
  if (!result) return errorResponse(context.request, context.env, 404, "case_not_found", "Case was not found.");
  return jsonResponse(context.request, context.env, {
    schema: "langerface-case-export/v0.1",
    exported_at: new Date().toISOString(),
    raw_media_included: false,
    ...result,
  });
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  if (request.method === "OPTIONS") return optionsResponse(request, env);

  const url = new URL(request.url);
  const route = matchRoute(request.method, url.pathname);
  if (!route) return errorResponse(request, env, 404, "route_not_found", "Route was not found.");

  try {
    return await route.handler({ env, request, url, params: route.params });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unexpected worker error.";
    return errorResponse(request, env, 500, "worker_error", message);
  }
}

export default {
  fetch: handleRequest,
} satisfies ExportedHandler<Env>;
