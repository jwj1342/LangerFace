import {
  add,
  clamp,
  cross,
  dot,
  mul,
  norm,
  sub,
  type Vec2,
  type Vec3,
} from "./incisionToolCore.ts";

export const INCISION_LESION_NORMALIZATION_SCHEMA = "incision-lesion-normalization/v0.2";

export interface PlanningLesionInput {
  center: Vec3;
  boundary?: Vec3[];
  diameter_mm: number;
  boundary_mode?: string;
  boundary_source?: string;
}

export interface PlanningLesionNormalization {
  schema: typeof INCISION_LESION_NORMALIZATION_SCHEMA;
  applied: boolean;
  status: "normalized" | "not_applicable" | "insufficient_boundary" | "degenerate_boundary";
  boundary_role: "planning_geometry" | "planning_scale" | "audit_only" | "unavailable";
  boundary_point_count: number;
  planning_center: Vec3;
  planning_diameter_mm: number;
  detected_area_mm2: number | null;
  detected_equivalent_diameter_mm: number | null;
  detected_enclosing_diameter_mm: number | null;
  detected_compactness: number | null;
  detected_centroid: Vec3 | null;
  detected_center_shift_mm: number | null;
  detected_to_planning_diameter_ratio: number | null;
  clinical_scale_source: "operator_input" | "controlled_marker_enclosing_circle";
  clinical_scale_status: "requires_clinician_confirmation" | "derived_from_detected_boundary";
}

function finiteBoundary(value: unknown): Vec3[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((point): point is number[] => Array.isArray(point) && point.length === 3)
    .map((point) => point.map(Number) as Vec3)
    .filter((point) => point.every(Number.isFinite));
}

function newellNormal(points: Vec3[]): Vec3 {
  const accumulated: Vec3 = [0, 0, 0];
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    accumulated[0] += (current[1] - next[1]) * (current[2] + next[2]);
    accumulated[1] += (current[2] - next[2]) * (current[0] + next[0]);
    accumulated[2] += (current[0] - next[0]) * (current[1] + next[1]);
  }
  return accumulated;
}

function planeBasis(points: Vec3[], origin: Vec3, fallbackNormal: Vec3): { u: Vec3; v: Vec3 } {
  const rawNormal = newellNormal(points);
  const normal = Math.hypot(...rawNormal) > 1e-9 ? norm(rawNormal) : norm(fallbackNormal);
  let u: Vec3 | null = null;
  for (const point of points) {
    const radial = sub(point, origin);
    const tangent = sub(radial, mul(normal, dot(radial, normal)));
    if (Math.hypot(...tangent) > 1e-9) {
      u = norm(tangent);
      break;
    }
  }
  if (!u) {
    const reference: Vec3 = Math.abs(normal[2]) < 0.9 ? [0, 0, 1] : [0, 1, 0];
    u = norm(cross(reference, normal));
  }
  return { u, v: norm(cross(normal, u)) };
}

function projectedMeasurements(
  boundary: Vec3[],
  origin: Vec3,
  unitsPerMm: number,
  fallbackNormal: Vec3,
): {
  valid: boolean;
  center: Vec3;
  areaMm2: number | null;
  equivalentDiameterMm: number | null;
  enclosingDiameterMm: number | null;
  compactness: number | null;
  centerShiftMm: number | null;
} {
  if (boundary.length < 3 || !(unitsPerMm > 0)) {
    return { valid: false, center: origin, areaMm2: null, equivalentDiameterMm: null, enclosingDiameterMm: null, compactness: null, centerShiftMm: null };
  }
  const { u, v } = planeBasis(boundary, origin, fallbackNormal);
  const projected = boundary.map((point) => {
    const delta = sub(point, origin);
    return [dot(delta, u), dot(delta, v)] as Vec2;
  });
  let twiceArea = 0;
  let centroidX = 0;
  let centroidY = 0;
  let perimeterUnits = 0;
  for (let index = 0; index < projected.length; index += 1) {
    const current = projected[index];
    const next = projected[(index + 1) % projected.length];
    const cross2 = current[0] * next[1] - next[0] * current[1];
    twiceArea += cross2;
    centroidX += (current[0] + next[0]) * cross2;
    centroidY += (current[1] + next[1]) * cross2;
    perimeterUnits += Math.hypot(next[0] - current[0], next[1] - current[1]);
  }
  const areaUnits2 = Math.abs(twiceArea) * 0.5;
  if (!(areaUnits2 > 1e-10) || !(perimeterUnits > 1e-9)) {
    return { valid: false, center: origin, areaMm2: null, equivalentDiameterMm: null, enclosingDiameterMm: null, compactness: null, centerShiftMm: null };
  }
  const centroidScale = 1 / (3 * twiceArea);
  const centroidU = centroidX * centroidScale;
  const centroidV = centroidY * centroidScale;
  const center = add(add(origin, mul(u, centroidU)), mul(v, centroidV));
  const areaMm2 = areaUnits2 / (unitsPerMm * unitsPerMm);
  const perimeterMm = perimeterUnits / unitsPerMm;
  const enclosingRadiusUnits = projected.reduce((radius, point) => Math.max(
    radius,
    Math.hypot(point[0] - centroidU, point[1] - centroidV),
  ), 0);
  return {
    valid: true,
    center,
    areaMm2,
    equivalentDiameterMm: 2 * Math.sqrt(areaMm2 / Math.PI),
    enclosingDiameterMm: 2 * enclosingRadiusUnits / unitsPerMm,
    compactness: clamp(4 * Math.PI * areaMm2 / Math.max(perimeterMm * perimeterMm, 1e-12), 0, 1),
    centerShiftMm: Math.hypot(...sub(center, origin)) / unitsPerMm,
  };
}

export function isControlledMarkerLesion(input: Pick<PlanningLesionInput, "boundary_mode" | "boundary_source">): boolean {
  return input.boundary_mode === "controlled_marker"
    || input.boundary_source === "controlled_marker_confirmed";
}

export function normalizePlanningLesion(
  input: PlanningLesionInput,
  unitsPerMm: number,
  fallbackNormal: Vec3 = [0, 0, 1],
): PlanningLesionNormalization {
  const boundary = finiteBoundary(input.boundary);
  const controlledMarker = isControlledMarkerLesion(input);
  const measurements = projectedMeasurements(boundary, input.center, unitsPerMm, fallbackNormal);
  const applied = controlledMarker && measurements.valid;
  const equivalentDiameter = measurements.equivalentDiameterMm;
  const enclosingDiameter = measurements.enclosingDiameterMm;
  const planningDiameter = applied && enclosingDiameter != null
    ? enclosingDiameter
    : Number(input.diameter_mm);
  return {
    schema: INCISION_LESION_NORMALIZATION_SCHEMA,
    applied,
    status: applied
      ? "normalized"
      : !controlledMarker
        ? "not_applicable"
        : boundary.length < 3
          ? "insufficient_boundary"
          : "degenerate_boundary",
    // The detector-confirmed center is the stable lesion/planning anchor. A
    // boundary-derived centroid is useful for scale and audit, but must not
    // silently move the visible lesion or the incision axis after detection.
    boundary_role: boundary.length < 3 ? "unavailable" : applied ? "planning_scale" : "planning_geometry",
    boundary_point_count: boundary.length,
    planning_center: input.center,
    planning_diameter_mm: planningDiameter,
    detected_area_mm2: measurements.areaMm2,
    detected_equivalent_diameter_mm: equivalentDiameter,
    detected_enclosing_diameter_mm: enclosingDiameter,
    detected_compactness: measurements.compactness,
    detected_centroid: measurements.valid ? measurements.center : null,
    detected_center_shift_mm: measurements.centerShiftMm,
    detected_to_planning_diameter_ratio: equivalentDiameter == null || !(planningDiameter > 0)
      ? null
      : equivalentDiameter / planningDiameter,
    clinical_scale_source: applied ? "controlled_marker_enclosing_circle" : "operator_input",
    clinical_scale_status: applied ? "derived_from_detected_boundary" : "requires_clinician_confirmation",
  };
}
