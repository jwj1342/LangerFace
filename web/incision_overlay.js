const INCISION_OVERLAY_KEY = "langerface.incisionOverlay";

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len2 = (v) => dot(v, v);

function closestPointOnTriangle(p, a, b, c) {
  const ab = sub(b, a), ac = sub(c, a), ap = sub(p, a);
  const d1 = dot(ab, ap), d2 = dot(ac, ap);
  if (d1 <= 0 && d2 <= 0) return { point: a, weights: [1, 0, 0] };

  const bp = sub(p, b);
  const d3 = dot(ab, bp), d4 = dot(ac, bp);
  if (d3 >= 0 && d4 <= d3) return { point: b, weights: [0, 1, 0] };

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    return { point: add(a, mul(ab, v)), weights: [1 - v, v, 0] };
  }

  const cp = sub(p, c);
  const d5 = dot(ab, cp), d6 = dot(ac, cp);
  if (d6 >= 0 && d5 <= d6) return { point: c, weights: [0, 0, 1] };

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    return { point: add(a, mul(ac, w)), weights: [1 - w, 0, w] };
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    return { point: add(b, mul(sub(c, b), w)), weights: [0, 1 - w, w] };
  }

  const denom = 1 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  return { point: add(add(a, mul(ab, v)), mul(ac, w)), weights: [1 - v - w, v, w] };
}

export function pointToSurfaceRef(point, verts, tris) {
  let best = null;
  for (let i = 0; i < tris.length; i++) {
    const tri = tris[i];
    const hit = closestPointOnTriangle(point, verts[tri[0]], verts[tri[1]], verts[tri[2]]);
    const d2 = len2(sub(point, hit.point));
    if (!best || d2 < best.d2) best = { tri: i, weights: hit.weights, d2 };
  }
  if (!best) return null;
  return {
    tri: best.tri,
    u: best.weights[0],
    v: best.weights[1],
    w: best.weights[2],
    distance: Math.sqrt(best.d2),
  };
}

function refsFromPolyline(points, verts, tris) {
  if (!Array.isArray(points)) return [];
  return points.map((p) => pointToSurfaceRef(p, verts, tris)).filter(Boolean);
}

export function compileIncisionOverlay(record, verts, tris) {
  const candidate = record?.candidate;
  const tumor = record?.tumor || {};
  if (!candidate || !Array.isArray(candidate.polyline) || !Array.isArray(tumor.center)) return null;
  const overlay = {
    schema_version: "incision-overlay/v0.1",
    created_at: new Date().toISOString(),
    label: record.label || "切口候选",
    candidate_type: candidate.type,
    tumor_kind: tumor.kind,
    tumor: {
      center_ref: pointToSurfaceRef(tumor.center, verts, tris),
      boundary_refs: refsFromPolyline(tumor.boundary || [], verts, tris),
      diameter_mm: tumor.diameter_mm,
      margin_mm: tumor.margin_mm,
    },
    candidate: {
      polyline_refs: refsFromPolyline(candidate.polyline, verts, tris),
      length_mm: candidate.length_mm,
      width_mm: candidate.width_mm,
      guardrails_passed: record.guardrails?.passed === true,
    },
    audit: {
      raw_image_sent: false,
      source: "web/incision_agent",
      review_required: true,
    },
  };
  return validateIncisionOverlay(overlay) ? overlay : null;
}

export function validateIncisionOverlay(overlay) {
  if (!overlay || overlay.schema_version !== "incision-overlay/v0.1") return false;
  if (!overlay.tumor?.center_ref) return false;
  if (!Array.isArray(overlay.candidate?.polyline_refs) || overlay.candidate.polyline_refs.length < 2) return false;
  return overlay.candidate.polyline_refs.every((ref) => Number.isInteger(ref.tri) && Number.isFinite(ref.u) && Number.isFinite(ref.v));
}

export function mapSurfaceRefs(refs, landmarksPx, triangles) {
  const pts = [];
  const triIds = [];
  for (const ref of refs || []) {
    const tri = triangles[ref.tri];
    if (!tri) continue;
    const a = landmarksPx[tri[0]], b = landmarksPx[tri[1]], c = landmarksPx[tri[2]];
    if (!a || !b || !c) continue;
    const u = Number(ref.u), v = Number(ref.v), w = Number(ref.w ?? (1 - u - v));
    pts.push([
      u * a[0] + v * b[0] + w * c[0],
      u * a[1] + v * b[1] + w * c[1],
      u * a[2] + v * b[2] + w * c[2],
    ]);
    triIds.push(ref.tri);
  }
  return { pts, tris: triIds };
}

function hasSessionStorage() {
  try { return typeof sessionStorage !== "undefined" && sessionStorage !== null; }
  catch { return false; }
}

export function stageIncisionOverlay(overlay) {
  if (!validateIncisionOverlay(overlay) || !hasSessionStorage()) return false;
  try {
    sessionStorage.setItem(INCISION_OVERLAY_KEY, JSON.stringify(overlay));
    return true;
  } catch {
    return false;
  }
}

export function loadIncisionOverlay() {
  if (!hasSessionStorage()) return null;
  const raw = sessionStorage.getItem(INCISION_OVERLAY_KEY);
  if (!raw) return null;
  try {
    const overlay = JSON.parse(raw);
    return validateIncisionOverlay(overlay) ? overlay : null;
  } catch {
    return null;
  }
}

export function clearIncisionOverlay() {
  if (hasSessionStorage()) sessionStorage.removeItem(INCISION_OVERLAY_KEY);
}

export const __incisionOverlayForTests = {
  compileIncisionOverlay,
  mapSurfaceRefs,
  pointToSurfaceRef,
  validateIncisionOverlay,
};
