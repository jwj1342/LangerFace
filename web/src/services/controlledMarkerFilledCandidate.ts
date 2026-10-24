/**
 * 新手阅读入口：这是交互式图像分割，不是训练好的病理诊断模型。
 * 输入：原图RGBA像素、原图上的点击点、扫描/分析参数。输出：候选闭合边界或明确失败。
 * ok、confidence、共识次数都只描述工程规则；不能替代医生确认。
 * 教材会按函数名引用本文件。后续迭代请同步行为、注释、测试及算法版本指纹。
 */
import type { CV } from "@techstark/opencv-js";
import type { ControlledMarkerDetection, ControlledMarkerOptions, MarkerImageData, MarkerPoint } from "./controlledMarkerDetection.ts";
import { recoverScanPixelSolidCandidate, regularizeAcceptedBoundary, regularizeSolidBoundary } from "./controlledMarkerDetectionColorV035.ts";
interface Candidate {
    ok: boolean;
    boundary: MarkerPoint[];
    area_px: number;
}
interface Features {
    area: number;
    diameter: number;
    aspect: number;
    compactness: number;
    bbox: NonNullable<ControlledMarkerDetection["bbox"]>;
    center: MarkerPoint;
    foreground: number[];
    bg: number[];
    difference: number;
    noiseEstimate: number;
    snr: number;
    stepMedian: number;
    stepSupport: number;
    narrowWideEdgeRatio: number;
    corePixels: number;
    backgroundPixels: number;
}
interface Evaluation {
    result: ControlledMarkerDetection;
    route: string;
    reasons: string[];
    features?: Features;
    regularization?: Record<string, unknown>;
    baselineGuard?: Features;
    rejectedReasons?: string[];
}
/** 射线法判断点是否在多边形内部，用于判断扫描归属和采样前景。所有坐标都是原照片像素，不是页面CSS坐标。 */
function pointInPolygon(p: MarkerPoint, b: MarkerPoint[]): boolean { let inside = false; for (let i = 0, j = b.length - 1; i < b.length; j = i++) {
    const a = b[i], c = b[j];
    if ((a.y > p.y) !== (c.y > p.y) && p.x < (c.x - a.x) * (p.y - a.y) / (c.y - a.y) + a.x)
        inside = !inside;
} return inside; }
/** 鞋带公式计算闭合多边形面积，单位是像素平方；它描述当前输出大小，不能直接当成毫米尺寸或医学准确率。 */
function polygonArea(b: MarkerPoint[]): number { return Math.abs(b.reduce((s, a, i) => { const c = b[(i + 1) % b.length]; return s + a.x * c.y - c.x * a.y; }, 0) / 2); }
function distance(p: MarkerPoint, a: MarkerPoint, b: MarkerPoint): number { const dx = b.x - a.x, dy = b.y - a.y, t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t); }
/** 计算点到轮廓各线段的最近距离。采样时用它避开边缘混色：深处作为前景，外侧一定距离作为背景。 */
function distanceToBoundary(p: MarkerPoint, b: MarkerPoint[]): number { return b.reduce((m, a, i) => Math.min(m, distance(p, a, b[(i + 1) % b.length])), Infinity); }
function cross(a: MarkerPoint, b: MarkerPoint, c: MarkerPoint): number { return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); }
/** 最基本的几何检查：坐标有限、面积非零、边不相交。形状合法只是必要条件，合法的圆也可能圈错对象。 */
function simple(b: MarkerPoint[]): boolean { if (b.length < 3 || b.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)) || polygonArea(b) < 1e-6)
    return false; for (let i = 0; i < b.length; i++)
    for (let j = i + 2; j < b.length; j++) {
        if (i === 0 && j === b.length - 1)
            continue;
        const a = b[i], c = b[(i + 1) % b.length], d = b[j], e = b[(j + 1) % b.length];
        if (cross(a, c, d) * cross(a, c, e) < -1e-10 && cross(d, e, a) * cross(d, e, c) < -1e-10)
            return false;
    } return true; }
// 这些数字是当前算法的工程支持范围，非临床阈值。minimumArea为像素平方；
// 直径是包围盒最长边；support/ratio是无量纲比例。修改须用原故障和阴性回归，
// 不能为了接受瘢痕直接调低所有门槛，否则阴影、发丝和正常皮肤也可能被接受。
export const P = Object.freeze({ minimumArea: 64, minimumDiameter: 9, maxAnalysisDiameterRatio: 1.8, minimumAspect: .52, minimumCompactness: .45, minimumCorePixels: 12, minimumBackgroundPixels: 20, minimumRgbDifference: 4, minimumNoiseNormalizedDifference: 1.2, minimumBoundaryStepFraction: .24, minimumBoundarySupport: .55, minimumNarrowWideEdgeRatio: .35 });
const median = (a: number[]): number => { const b = a.slice().sort((a, b) => a - b); return b.length ? b[Math.floor(b.length / 2)] : 0; };
/** 读取原照片的RGB，可取邻域平均来减轻单像素噪声。这里的r是采样小邻域半径，不是扫描圈半径。 */
function rgb(image: MarkerImageData, p: MarkerPoint, r = 0): number[] { let n = 0, result = [0, 0, 0]; for (let y = Math.max(0, Math.round(p.y) - r); y <= Math.min(image.height - 1, Math.round(p.y) + r); y++)
    for (let x = Math.max(0, Math.round(p.x) - r); x <= Math.min(image.width - 1, Math.round(p.x) + r); x++) {
        const i = (y * image.width + x) * 4;
        for (let k = 0; k < 3; k++)
            result[k] += image.data[i + k];
        n++;
    } return result.map(v => v / Math.max(1, n)); }
/** GrabCut候选分割：把局部照片变成OpenCV矩阵，窗口外圈指定背景，中心2像素指定前景，其余为可能前景/背景，再迭代颜色与邻域模型。点击落在皮肤或高光时，强制前景也可能带偏分割，所以输出必须独立验证。finally中的delete释放WebAssembly内存，不能省略。 */
function grab(cv: CV, image: MarkerImageData, seed: MarkerPoint, radius: number, probableForeground = true): Candidate { const x0 = Math.max(0, Math.floor(seed.x - radius)), y0 = Math.max(0, Math.floor(seed.y - radius)), w = Math.min(image.width - x0, Math.ceil(seed.x + radius) - x0 + 1), h = Math.min(image.height - y0, Math.ceil(seed.y + radius) - y0 + 1); const mat = new cv.Mat(h, w, cv.CV_8UC3), mask = new cv.Mat(h, w, cv.CV_8UC1), bg = new cv.Mat(), fg = new cv.Mat(); try {
    for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
            const a = ((y + y0) * image.width + x + x0) * 4, b = (y * w + x) * 3;
            mat.data[b] = image.data[a];
            mat.data[b + 1] = image.data[a + 1];
            mat.data[b + 2] = image.data[a + 2];
            const d = Math.hypot(x + x0 - seed.x, y + y0 - seed.y);
            mask.data[y * w + x] = d > radius * .94 ? cv.GC_BGD : d <= 2 ? cv.GC_FGD : (probableForeground ? cv.GC_PR_FGD : cv.GC_PR_BGD);
        }
    if (typeof cv.setRNGSeed === 'function')
        cv.setRNGSeed(43);
    cv.grabCut(mat, mask, new cv.Rect(0, 0, w, h), bg, fg, 5, cv.GC_INIT_WITH_MASK);
    const binary = new cv.Mat(h, w, cv.CV_8UC1), contours = new cv.MatVector(), hierarchy = new cv.Mat();
    try {
        for (let i = 0; i < w * h; i++)
            binary.data[i] = mask.data[i] === cv.GC_FGD || mask.data[i] === cv.GC_PR_FGD ? 255 : 0;
        cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
        const list: Candidate[] = [];
        for (let k = 0; k < contours.size(); k++) {
            const c = contours.get(k);
            try {
                if (cv.pointPolygonTest(c, new cv.Point(seed.x - x0, seed.y - y0), false) >= 0) {
                    const boundary = [];
                    for (let i = 0; i < c.data32S.length; i += 2)
                        boundary.push({ x: c.data32S[i] + x0, y: c.data32S[i + 1] + y0 });
                    list.push({ ok: true, boundary, area_px: cv.contourArea(c) });
                }
            }
            finally {
                c.delete();
            }
        }
        const selected = list.sort((a, b) => b.area_px - a.area_px)[0];
        return { ok: !!selected, boundary: selected?.boundary || [], area_px: selected?.area_px || 0 };
    }
    finally {
        binary.delete();
        contours.delete();
        hierarchy.delete();
    }
}
finally {
    mat.delete();
    mask.delete();
    bg.delete();
    fg.delete();
} }
/** 从边界计算面积、最长边、长宽比、紧致度、包围盒和顶点平均中心。这里的center不是严格的面积质心；它用于本实现的径向采样，不应冒充解剖中心。 */
function geometry(b: MarkerPoint[]) { const xs = b.map(p => p.x), ys = b.map(p => p.y), x = Math.min(...xs), y = Math.min(...ys), width = Math.max(...xs) - x, height = Math.max(...ys) - y, area = polygonArea(b), diameter = Math.max(width, height), perimeter = b.reduce((s, p, i) => s + Math.hypot(p.x - b[(i + 1) % b.length].x, p.y - b[(i + 1) % b.length].y), 0); return { area, diameter, aspect: Math.min(width, height) / diameter, compactness: 4 * Math.PI * area / (perimeter * perimeter), bbox: { x, y, width, height }, center: { x: b.reduce((s, p) => s + p.x, 0) / b.length, y: b.reduce((s, p) => s + p.y, 0) / b.length } }; }
/** 用原照片检验一个候选：先查尺寸/形状和原扫描覆盖，再比较内部核心与外侧背景的颜色、噪声和边缘变化。色差足够却没有清楚边界时仍拒绝，以免把阴影当作肿物。失败时返回baseline只是保留调用方的参照，必须同时读route和reasons，不能把返回对象非空当作接受。 */
function evaluateOne(image: MarkerImageData, seed: MarkerPoint, scanRadius: number, analysisRadius: number, baseline: ControlledMarkerDetection, candidate: Candidate): Evaluation {
    const b = candidate.boundary || [], reasons = [];
    if (!candidate.ok || !simple(b))
        return { result: baseline, route: 'retain_baseline', reasons: ['no_simple_candidate'] };
    const g = geometry(b);
    if (g.area < P.minimumArea || g.diameter < P.minimumDiameter || g.diameter > analysisRadius * P.maxAnalysisDiameterRatio)
        reasons.push('outside_supported_scale');
    if (g.aspect < P.minimumAspect || g.compactness < P.minimumCompactness)
        reasons.push('noncompact_or_thin');
    // The operator selects a scan area, not a mandatory foreground pixel.
    if (b.some(p => Math.hypot(p.x - seed.x, p.y - seed.y) > scanRadius * .95))
        reasons.push('not_enclosed_within_scan');
    const core: number[][] = [], background: number[][] = [], noise: number[] = [];
    for (let y = Math.max(0, Math.floor(g.bbox.y - 8)); y <= Math.min(image.height - 1, Math.ceil(g.bbox.y + g.bbox.height + 8)); y++)
        for (let x = Math.max(0, Math.floor(g.bbox.x - 8)); x <= Math.min(image.width - 1, Math.ceil(g.bbox.x + g.bbox.width + 8)); x++) {
            const p = { x: x + .5, y: y + .5 }, inside = pointInPolygon(p, b), distance = distanceToBoundary(p, b);
            if (inside && distance >= 3)
                core.push(rgb(image, { x, y }));
            else if (!inside && distance >= 2 && distance <= 7 && Math.hypot(x - seed.x, y - seed.y) <= scanRadius) {
                const v = rgb(image, { x, y });
                background.push(v);
                const avg = rgb(image, { x, y }, 1);
                noise.push(Math.hypot(...v.map((c, k) => c - avg[k])));
            }
        }
    if (core.length < P.minimumCorePixels || background.length < P.minimumBackgroundPixels)
        return { result: baseline, route: 'retain_baseline', reasons: [...reasons, 'insufficient_color_evidence'] };
    const foreground = [0, 1, 2].map(k => median(core.map(c => c[k]))), bg = [0, 1, 2].map(k => median(background.map(c => c[k]))), delta = bg.map((v, k) => v - foreground[k]), difference = Math.hypot(...delta), unit = delta.map(v => v / Math.max(1e-8, difference)), noiseEstimate = Math.max(1, median(noise)), snr = difference / noiseEstimate;
    if (difference < P.minimumRgbDifference || snr < P.minimumNoiseNormalizedDifference)
        reasons.push('insufficient_relative_color_difference');
    const steps = [], narrow = [], wide = [];
    for (const p of b) {
        const d = Math.hypot(p.x - g.center.x, p.y - g.center.y) || 1, ux = (p.x - g.center.x) / d, uy = (p.y - g.center.y) / d;
        const sampleStep = (span: number) => { const inner = rgb(image, { x: p.x - ux * span, y: p.y - uy * span }, 1), outer = rgb(image, { x: p.x + ux * span, y: p.y + uy * span }, 1); return outer.reduce((sum, v, k) => sum + (v - inner[k]) * unit[k], 0); };
        steps.push(sampleStep(2.5) / Math.max(1, difference));
        narrow.push(sampleStep(1.5));
        wide.push(sampleStep(5));
    }
    const stepMedian = median(steps), stepSupport = steps.filter(x => x >= P.minimumBoundaryStepFraction).length / steps.length, narrowWideEdgeRatio = median(narrow) / Math.max(1, median(wide));
    if (stepMedian < P.minimumBoundaryStepFraction || stepSupport < P.minimumBoundarySupport)
        reasons.push('diffuse_or_inconsistent_boundary');
    // A compact pigmented region can have a soft luminance edge. Permit
    // that route only when its RGB change has a substantial component
    // perpendicular to background brightness, with strong edge support.
    const bgNorm = Math.hypot(...bg);
    const shadingProjection = delta.reduce((sum, value, k) => sum + value * bg[k], 0) / Math.max(1, bgNorm);
    const chromaticMagnitude = Math.sqrt(Math.max(0, difference * difference - shadingProjection * shadingProjection));
    const chromaticFraction = chromaticMagnitude / Math.max(1, difference);
    const compactChromaticSoftEdge = g.diameter <= 30 && chromaticMagnitude >= 12
        && chromaticFraction >= .45 && stepSupport >= .8;
    if (narrowWideEdgeRatio < P.minimumNarrowWideEdgeRatio && !compactChromaticSoftEdge)
        reasons.push('gradual_shading_edge');
    const features = { ...g, foreground, bg, difference, noiseEstimate, snr, stepMedian, stepSupport, narrowWideEdgeRatio, corePixels: core.length, backgroundPixels: background.length };
    if (reasons.length)
        return { result: baseline, route: 'retain_baseline', reasons, features };
    const source: ControlledMarkerDetection = { ...baseline, ok: true, failure_code: null, geometry_mode: 'dark_component', warnings: [], diagnostics: {}, boundary: b, center: g.center, area_px: g.area, bbox: g.bbox }, regularized = regularizeAcceptedBoundary(source), boundary = regularized === source ? regularizeSolidBoundary(source).boundary : regularized.boundary;
    const finalGeometry = geometry(boundary), result: ControlledMarkerDetection = { ...baseline, ok: true, failure_code: null, geometry_mode: 'dark_component', boundary, center: finalGeometry.center, bbox: finalGeometry.bbox, area_px: finalGeometry.area, warnings: [...(baseline.warnings || []), 'relative_color_filled_candidate'], diagnostics: { ...(baseline.diagnostics || {}), relative_color_candidate: true, ...regularized.diagnostics } };
    return { result, route: 'relative_color_filled_candidate', reasons: [], features, regularization: { method: regularized === source ? 'local_corner_only' : 'existing_bounded_periodic_low_frequency', ...regularized.diagnostics } };
}
/** 沿当前轮廓中心向64个方向寻找附近更强的颜色台阶，限定搜索和面积变化。它依赖已有轮廓与前景/背景色差，不能凭空发现远处浅色瘢痕。 */
function refineExistingEdge(image: MarkerImageData, candidate: ControlledMarkerDetection, features?: Features): ControlledMarkerDetection | null { if (!features)
    return null; const b = candidate.boundary, g = geometry(b), center = g.center, delta = features.bg.map((v, k) => v - features.foreground[k]), norm = Math.hypot(...delta), unit = delta.map(v => v / Math.max(1, norm)), cross = (a: MarkerPoint, b: MarkerPoint) => a.x * b.y - a.y * b.x, boundary = []; for (let i = 0; i < 64; i++) {
    const angle = 2 * Math.PI * i / 64, v = { x: Math.cos(angle), y: Math.sin(angle) }, hits = [];
    for (let j = 0; j < b.length; j++) {
        const a = b[j], z = b[(j + 1) % b.length], s = { x: z.x - a.x, y: z.y - a.y }, q = { x: a.x - center.x, y: a.y - center.y }, den = cross(v, s);
        if (Math.abs(den) < 1e-9)
            continue;
        const r = cross(q, s) / den, t = cross(q, v) / den;
        if (r > 0 && t >= 0 && t <= 1)
            hits.push(r);
    }
    if (!hits.length)
        return null;
    const originalRadius = Math.max(...hits);
    let best: {
        r: number;
        score: number;
    } | null = null;
    for (let r = Math.max(2, originalRadius * .65); r <= originalRadius * 1.25; r += .5) {
        const inside = rgb(image, { x: center.x + v.x * (r - 2.5), y: center.y + v.y * (r - 2.5) }, 1), outside = rgb(image, { x: center.x + v.x * (r + 2.5), y: center.y + v.y * (r + 2.5) }, 1), edge = outside.reduce((sum, c, k) => sum + (c - inside[k]) * unit[k], 0) / Math.max(1, norm), score = edge - .03 * Math.abs(r - originalRadius) / Math.max(1, originalRadius);
        if (!best || score > best.score)
            best = { r, score };
    }
    if (!best)
        return null;
    boundary.push({ x: center.x + v.x * best.r, y: center.y + v.y * best.r });
} const after = geometry(boundary), ratio = after.area / g.area; if (!simple(boundary) || ratio < .65 ** 2 || ratio > 1.35)
    return null; return { ...candidate, boundary, area_px: after.area, bbox: after.bbox, center: after.center }; }
/** 协调新GrabCut候选与旧路径：保留有证据的笔圈/实心边界；必要时复核或移动旧边缘；无法证实的填充结果明确拒识。各个preserved分支只代表工程证据合同，不是医生签认。 */
export function evaluateCandidate(image: MarkerImageData, seed: MarkerPoint, scanRadius: number, analysisRadius: number, baseline: ControlledMarkerDetection, candidate: Candidate): Evaluation {
    const result = evaluateOne(image, seed, scanRadius, analysisRadius, baseline, candidate);
    // An ink annulus has a much stronger edge than its skin-coloured core.
    // Preserve that existing enclosed boundary instead of filling the pen ring.
    if (baseline.ok && baseline.geometry_mode === "enclosed_region"
        && result.features && result.features.stepMedian >= 2)
        return { result: baseline, route: "preserved_pen_annulus", reasons: [] };
    const baselineDiagnostics = baseline.diagnostics as Record<string, unknown> | undefined;
    const baselineBox = baseline.bbox;
    const baselineWarnings = new Set(baseline.warnings || []);
    const radialBoundarySupport = Number(baselineDiagnostics?.boundary_support_ratio || 0);
    const radialRepairFraction = Number(baselineDiagnostics?.repair_fraction || 1);
    const hasDirectScanProposal = baselineWarnings.has('scan_solid_direct_proposal_recovered')
        && Number(baselineDiagnostics?.scan_solid_proposal_core_dark_ratio || 0) >= .90
        && Number(baselineDiagnostics?.solid_boundary_envelope_support_ratio || 0) >= .95
        && Number(baselineDiagnostics?.solid_boundary_envelope_area_ratio || 0) <= 2.10;
    const recoveredSolidBaseline = baseline.ok
        && baseline.geometry_mode === 'dark_component'
        && !!baselineBox
        && baselineWarnings.has('solid_component_outer_boundary_recovered')
        && baselineWarnings.has('solid_boundary_envelope_recovered')
        && baselineWarnings.has('scan_solid_core_anchor_recovered')
        && baselineWarnings.has('fixed_scale_unclipped_solid_anchor_recovered')
        && Number(baselineDiagnostics?.boundary_support_ratio || 0) >= .9
        && Number(baselineDiagnostics?.solid_component_core_dark_ratio || 0) >= .8
        && Number(baselineDiagnostics?.solid_component_contrast || 0) >= 30
        && Number(baselineDiagnostics?.scan_solid_proposal_consensus_count || 0) >= 2
        && Number(baselineDiagnostics?.solid_boundary_envelope_support_ratio || 0) >= .95
        // Core darkness and proposal consensus can coexist with a mostly
        // reconstructed radial contour. Require real boundary support for
        // this fallback; the explicit direct-proposal route has its own
        // stricter geometry/coverage contract above.
        && ((radialBoundarySupport >= .65 && radialRepairFraction <= .35) || hasDirectScanProposal)
        && !('scan_probe_consensus_count' in (baselineDiagnostics || {}));
    const baselineStronglySupported = baseline.ok
        && baseline.geometry_mode === 'dark_component'
        && !!baselineBox
        && Math.max(baselineBox.width, baselineBox.height) <= analysisRadius * P.maxAnalysisDiameterRatio
        && Number(baselineDiagnostics?.boundary_support_ratio || 0) >= .9
        && Number(baselineDiagnostics?.solid_component_contrast || 0) >= 30
        && Number(baselineDiagnostics?.solid_component_core_dark_ratio || 0) >= .72
        && Number(baselineDiagnostics?.solid_boundary_envelope_support_ratio || 0) >= .95
        && !('scan_probe_consensus_count' in (baselineDiagnostics || {}));
    const preserveRecoveredSolidBaseline = baselineStronglySupported || recoveredSolidBaseline;
    if ((result.route !== 'retain_baseline' && !preserveRecoveredSolidBaseline) || !baseline.ok || baseline.geometry_mode !== 'dark_component')
        return result;
    const prior = evaluateOne(image, seed, scanRadius, analysisRadius, baseline, baseline);
    // Keep a compact baseline only when its own boundary evidence is strong
    // and no scan consensus points to a competing object. This prevents a
    // later oversized GrabCut proposal from erasing a supported scar-like
    // target, while preserving the existing edge and wrong-point rejection.
    if (preserveRecoveredSolidBaseline) {
        return { result: baseline, route: 'preserved_supported_baseline_boundary', reasons: [], features: prior.features };
    }
    if (prior.route !== 'retain_baseline') {
        // This candidate has passed shape, colour, edge and scan coverage
        // checks. The click's position within that scan is not extra evidence.
        return { ...prior, route: 'validated_legacy_filled_candidate' };
    }
    // A collapsed GrabCut mask is absence of a useful proposal, not evidence
    // against a previously supported, seed-owned filled component. Keep the
    // old geometry only with strong original core evidence and local contrast.
    const originalDiagnostics = baseline.diagnostics as Record<string, unknown> | undefined;
    if (candidate.area_px < P.minimumArea && prior.features
        && !prior.reasons.includes("not_enclosed_within_scan")
        && prior.features.difference >= 24 && prior.features.snr >= 4
        && Number(originalDiagnostics?.solid_component_core_dark_ratio) >= .95
        && Number(originalDiagnostics?.scan_solid_proposal_consensus_count) >= 2)
        return { result: baseline, route: "preserved_supported_legacy_core", reasons: [], features: prior.features };
    if (!prior.reasons.includes('not_enclosed_within_scan')) {
        const refined = refineExistingEdge(image, baseline, prior.features);
        if (refined) {
            const validated = evaluateOne(image, seed, scanRadius, analysisRadius, baseline, refined);
            if (validated.route !== 'retain_baseline')
                return { ...validated, route: 'local_edge_relocated_legacy_candidate', baselineGuard: prior.features };
        }
    }
    const rejectedReasons = [...new Set(prior.reasons)];
    return { ...result, result: { ...baseline, ok: false, failure_code: 'unstable_enclosure', center: null, boundary: [], area_px: 0, bbox: null, geometry_mode: null, seed_relation: null, confidence: 0, rejected_boundary: baseline.boundary, rejected_geometry_mode: baseline.geometry_mode, rejected_reasons: rejectedReasons, warnings: [...(baseline.warnings || []), 'filled_fallback_evidence_rejected', ...rejectedReasons] }, route: 'reject_unverified_filled_fallback', baselineGuard: prior.features, rejectedReasons };
}
/** 多尺度暗斑锚点：高斯平滑后估计二维曲率，优先寻找两个方向都凹下去的暗色团块，抑制单方向细线。它偏向暗色紧凑目标，浅色或细长瘢痕可能根本没有合适锚点。固定原图采样相位可减少轻微移动扫描圈造成的变化，但不能保证所有落点一致。 */
function discoverFilledAnchors(cv: CV, image: MarkerImageData, seed: MarkerPoint, radius: number, analysis = 36): (MarkerPoint & {
    score: number;
    sigma: number;
})[] {
    const pad = Math.ceil(radius + analysis * 2), x0 = Math.max(0, Math.floor(seed.x - pad)), y0 = Math.max(0, Math.floor(seed.y - pad)), w = Math.min(image.width - x0, 2 * pad + 1), h = Math.min(image.height - y0, 2 * pad + 1), gray = new cv.Mat(h, w, cv.CV_32FC1), blur = new cv.Mat(), all = [];
    try {
        for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
                const k = ((y + y0) * image.width + x + x0) * 4;
                gray.data32F[y * w + x] = Math.round(.299 * image.data[k] + .587 * image.data[k + 1] + .114 * image.data[k + 2]);
            }
        for (const sigma of [3, 6, 10]) {
            cv.GaussianBlur(gray, blur, new cv.Size(0, 0), sigma, sigma, cv.BORDER_REFLECT_101);
            const step = Math.max(2, Math.round(sigma / 2));
            const a = blur.data32F;
            // Keep the sampling phase on original-image coordinates. Moving
            // the scan circle must not move the proposal grid over the lesion.
            for (let y = step + 2 + ((y0 + step + 2) % 2); y < h - step - 2; y += 2)
                for (let x = step + 2 + ((x0 + step + 2) % 2); x < w - step - 2; x += 2) {
                    const px = x + x0, py = y + y0;
                    if (Math.hypot(px - seed.x, py - seed.y) > radius - 4)
                        continue;
                    const v = a[y * w + x], xx = (a[y * w + x + step] + a[y * w + x - step] - 2 * v) / (step * step), yy = (a[(y + step) * w + x] + a[(y - step) * w + x] - 2 * v) / (step * step), xy = (a[(y + step) * w + x + step] - a[(y + step) * w + x - step] - a[(y - step) * w + x + step] + a[(y - step) * w + x - step]) / (4 * step * step), t = xx + yy, delta = Math.sqrt((xx - yy) ** 2 + 4 * xy * xy), lo = (t - delta) / 2, hi = (t + delta) / 2, score = lo * sigma * sigma;
                    if (score < 2 || lo / Math.max(1e-8, hi) < .2)
                        continue;
                    all.push({ x: px, y: py, score, sigma });
                }
        }
        all.sort((a, b) => b.score - a.score);
        const kept: (MarkerPoint & {
            score: number;
            sigma: number;
        })[] = [];
        for (const a of all) {
            if (kept.every(b => Math.hypot(a.x - b.x, a.y - b.y) > analysis * .65))
                kept.push(a);
            if (kept.length === 5)
                break;
        }
        return kept;
    }
    finally {
        gray.delete();
        blur.delete();
    }
}
/** 围绕图像锚点用多个分析半径生成候选，并逐个在原图验证；最后仍检查是否完整落在操作者原扫描圈内。面积×色差×紧致度只是当前排序策略，不是概率或医学置信度。 */
function selectScanLocalCandidate(cv: CV, image: MarkerImageData, scanSeed: MarkerPoint, scanRadius: number, analysisRadius: number, baseline: ControlledMarkerDetection): Evaluation | null {
    const anchors = discoverFilledAnchors(cv, image, scanSeed, scanRadius, analysisRadius);
    const accepted: (Evaluation & {
        score: number;
    })[] = [];
    for (const anchor of anchors)
        for (const localRadius of [analysisRadius * 7 / 9, analysisRadius, analysisRadius * 4 / 3]) {
            const candidate = grab(cv, image, anchor, localRadius);
            // Local evidence belongs to the proposal window, not to a scan
            // circle translated to this anchor. Check operator coverage below
            // against the original scan seed after regularization.
            const evaluated = evaluateOne(image, anchor, localRadius, analysisRadius, baseline, candidate);
            if (baseline.ok && baseline.geometry_mode === "enclosed_region" && evaluated.features && evaluated.features.stepMedian >= 2)
                return { result: baseline, route: "preserved_pen_annulus", reasons: [] };
            if (evaluated.route === "retain_baseline" || evaluated.result.boundary.some(p => Math.hypot(p.x - scanSeed.x, p.y - scanSeed.y) > scanRadius * .95))
                continue;
            accepted.push({ ...evaluated, score: evaluated.result.area_px * (evaluated.features?.difference || 0) * (evaluated.features?.compactness || 0) });
        }
    accepted.sort((a, b) => b.score - a.score);
    const selected = accepted[0];
    if (!selected)
        return null;
    return { ...selected, route: "scan_local_filled_candidate", result: { ...selected.result, diagnostics: { ...selected.result.diagnostics, scan_local_anchor_count: anchors.length } } };
}
let cvReady: Promise<CV> | null = null;
/** 按需加载并缓存OpenCV，避免每次点击重复初始化。只用于肿物请求；不改变RSTL模型和生命周期。缺少GrabCut时由调用方明确拒识。 */
async function getCv(): Promise<CV> { if (!cvReady)
    cvReady = (async () => { const { loadMarkerOpenCv } = await import("./controlledMarkerOpenCvRuntime.ts"), api = await loadMarkerOpenCv(); if (typeof api.grabCut !== "function")
        throw new Error("OpenCV GrabCut unavailable"); return api; })(); return cvReady; }
/** Refinement is loaded only for a controlled-marker request; no RSTL/model lifecycle is changed. */
/** 正式异步复核主入口：校验输入→保留少数已有强证据路径→生成并检验GrabCut候选→搜索局部锚点→统一输出状态。异常不会伪造成功；会清空接受边界并记录运行时不可用。scanRadius控制扫描覆盖，analysisRadius控制支持尺度；两者单位均为原图像素。 */
async function refineFilledCandidateBaseline(image: MarkerImageData, seed: MarkerPoint, options: ControlledMarkerOptions, baseline: ControlledMarkerDetection): Promise<ControlledMarkerDetection> {
    if (!Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.data.length < image.width * image.height * 4 || !Number.isFinite(seed.x) || !Number.isFinite(seed.y) || seed.x < 0 || seed.y < 0 || seed.x >= image.width || seed.y >= image.height)
        return baseline;
    // A highlight can also produce enclosed_region. Pen compatibility is
    // decided by the foreground/background evidence, not this geometry label.
    const scanRadius = Number(baseline.scan?.radius_px || options.roiRadius || 36), analysisRadius = Number(options.analysisRoiRadius || scanRadius);
    const baselineDiagnostics = baseline.diagnostics as Record<string, unknown> | undefined;
    const baselineWarnings = new Set(baseline.warnings || []);
    const baselineBox = baseline.bbox;
    // Size alone is not evidence that a mostly reconstructed radial contour
    // is complete. Such recoveries must still reach local image validation on
    // both sides of the analysis-size boundary. Keep the existing large-object
    // and explicit multi-window direct-proposal paths otherwise unchanged.
    const weakReconstructedBoundary = baselineWarnings.has('solid_component_outer_boundary_recovered')
        && baselineWarnings.has('solid_boundary_envelope_recovered')
        && !baselineWarnings.has('scan_solid_direct_proposal_recovered')
        && Number(baselineDiagnostics?.boundary_support_ratio) < .65
        && Number(baselineDiagnostics?.repair_fraction) > .35;
    if (baseline.ok && baselineBox
        && Math.max(baselineBox.width, baselineBox.height) > analysisRadius * P.maxAnalysisDiameterRatio
        && !weakReconstructedBoundary)
        return baseline;
    // The colour candidate can be rejected after the scan-wide detector has
    // already recovered a complete filled boundary from several fixed
    // windows. That route is stronger than a single GrabCut proposal, but it
    // inherits scan-probe diagnostics from the witness used to build the
    // proposal. Treat the explicit direct-proposal contract as sufficient
    // evidence for preservation; otherwise the async refinement layer turns a
    // valid synchronous result into unstable_enclosure.
    const directScanSolidRecovery = baseline.ok
        && baseline.geometry_mode === 'dark_component'
        && !!baselineBox
        && baselineWarnings.has('scan_solid_direct_proposal_recovered')
        && baselineWarnings.has('scan_solid_core_anchor_recovered')
        && baselineWarnings.has('fixed_scale_unclipped_solid_anchor_recovered')
        && baselineWarnings.has('solid_boundary_envelope_recovered')
        && Number(baselineDiagnostics?.solid_component_core_dark_ratio || 0) >= .90
        && Number(baselineDiagnostics?.scan_solid_proposal_consensus_count || 0) >= 2
        && Number(baselineDiagnostics?.solid_boundary_envelope_support_ratio || 0) >= .95
        && Number(baselineDiagnostics?.solid_boundary_envelope_area_ratio || 0) <= 2.10
        && Math.max(baselineBox.width, baselineBox.height) <= analysisRadius * P.maxAnalysisDiameterRatio;
    const baselineStronglySupported = baseline.ok
        && baseline.geometry_mode === 'dark_component'
        && baseline.seed_relation === 'on_marker'
        && !!baseline.bbox
        && baselineWarnings.has('solid_component_outer_boundary_recovered')
        && baselineWarnings.has('solid_boundary_envelope_recovered')
        && baselineWarnings.has('scan_solid_core_anchor_recovered')
        && baselineWarnings.has('fixed_scale_unclipped_solid_anchor_recovered')
        && Number(baselineDiagnostics?.boundary_support_ratio || 0) >= .9
        && Number(baselineDiagnostics?.solid_component_core_dark_ratio || 0) >= .8
        && Number(baselineDiagnostics?.solid_component_contrast || 0) >= 30
        && Number(baselineDiagnostics?.scan_solid_proposal_consensus_count || 0) >= 2
        && !('scan_probe_consensus_count' in (baselineDiagnostics || {}));
    if (directScanSolidRecovery || baselineStronglySupported)
        return {
            ...baseline,
            diagnostics: {
                ...baseline.diagnostics,
                filled_candidate_route: directScanSolidRecovery
                    ? 'preserved_direct_scan_solid_boundary'
                    : 'preserved_supported_baseline_boundary',
            },
        };
    try {
        const cv = await getCv(), candidate = grab(cv, image, seed, Math.min(96, scanRadius));
        let selected = evaluateCandidate(image, seed, scanRadius, analysisRadius, baseline, candidate);
        // A pen annulus keeps its established enclosed inner boundary. Filled
        // targets are proposed at local image features; a wide operator scan
        // is coverage, not a command to broaden the colour-model window.
        // A rejected baseline can still have a supported target in the scan.
        if (selected.route !== "preserved_pen_annulus"
            && selected.route !== "preserved_supported_baseline_boundary") {
            const local = selectScanLocalCandidate(cv, image, seed, scanRadius, analysisRadius, baseline);
            if (local) selected = local;
        }
        const result = selected.result;
        if (selected.route === "retain_baseline")
            return result;
        const diagnostics = { ...result.diagnostics, filled_candidate_route: selected.route, filled_candidate_color_difference: selected.features?.difference, filled_candidate_snr: selected.features?.snr, filled_candidate_narrow_wide_ratio: selected.features?.narrowWideEdgeRatio };
        if (!result.ok)
            return { ...result, marker_area_px: 0, marker_bbox: null, diagnostics };
        return { ...result, seed_relation: pointInPolygon(seed, result.boundary) ? "enclosed" : distanceToBoundary(seed, result.boundary) <= 3 ? "on_marker" : "near_marker", marker_area_px: Math.round(result.area_px), marker_bbox: result.bbox, candidate_count: Math.max(1, result.candidate_count), confidence: Math.max(result.confidence, Math.min(.9, (selected.features?.snr || 0) / ((selected.features?.snr || 0) + 2))), diagnostics };
    }
    catch {
        return { ...baseline, ok: false, failure_code: "unstable_enclosure", center: null, boundary: [], area_px: 0, bbox: null, geometry_mode: null, seed_relation: null, marker_area_px: 0, marker_bbox: null, confidence: 0, rejected_boundary: baseline.boundary, rejected_geometry_mode: baseline.geometry_mode, rejected_reasons: ["filled_candidate_runtime_unavailable"], warnings: [...baseline.warnings, "filled_candidate_runtime_unavailable"] };
    }
}

/**
 * 只复核强暗色核心的旧恢复分支，不覆盖已有独立局部分割或笔圈。
 * 例如发丝使某次点击得到整块暗斑、另一次只得到暗斑的一小块：
 * 先以已选对象为中心寻找原像素组件，再用同一套颜色和边缘门槛
 * 判断它是否有证据。点击点只负责最后的原扫描覆盖检查。
 *
 * .95复用旧“强核心回退”的门槛，比普通直恢复的.92更严格。
 * 该方法仍只能处理清楚的暗色实心目标，不能识别医学意义的瘢痕。
 */
function refineRecoveredPixelBoundary(
    image: MarkerImageData, seed: MarkerPoint, options: ControlledMarkerOptions,
    baseline: ControlledMarkerDetection,
): ControlledMarkerDetection {
    const diagnostics = baseline.diagnostics as Record<string, unknown> | undefined;
    const eligibleRoutes = new Set([
        'validated_legacy_filled_candidate',
        'preserved_supported_legacy_core',
        'preserved_direct_scan_solid_boundary',
    ]);
    if (!baseline.ok || baseline.geometry_mode !== 'dark_component' || !baseline.center
        || !eligibleRoutes.has(String(diagnostics?.filled_candidate_route || ''))
        || !baseline.warnings.includes('scan_solid_core_anchor_recovered')
        || Number(diagnostics?.scan_solid_proposal_consensus_count || 0) < 2
        || Number(diagnostics?.solid_component_core_dark_ratio || 0) < .95)
        return baseline;

    const raw = recoverScanPixelSolidCandidate(image, baseline.center, options, baseline);
    // 至少保留原对象的中心；附近更黑的发丝或另一个痣不能抢走结果。
    if (!raw?.ok || !raw.center || !pointInPolygon(baseline.center, raw.boundary))
        return baseline;
    const analysis = Number(options.analysisRoiRadius || options.roiRadius || 36);
    const scan = Number(baseline.scan?.radius_px || options.roiRadius || analysis);
    // 外观证据在对象周围取样，避免移动鼠标就改变前景/背景模型。
    // evaluateOne原有的尺寸、形状、颜色、噪声及边缘门槛全部保留。
    const evaluated = evaluateOne(image, raw.center, analysis, analysis, baseline, raw);
    if (evaluated.route === 'retain_baseline') return baseline;
    // 同时核原始组件和最终平滑边界；不靠平滑缩回扫描圈来掩盖截断。
    // 这里不扩大原扫描圈，也不裁掉超出的部分伪造完整肿物。
    const complete = [...raw.boundary, ...evaluated.result.boundary].every(
        p => Math.hypot(p.x - seed.x, p.y - seed.y) <= scan,
    );
    if (!complete) {
        return { ...baseline, ok: false, failure_code: 'unstable_enclosure',
            center: null, boundary: [], area_px: 0, bbox: null, geometry_mode: null,
            seed_relation: null, marker_area_px: 0, marker_bbox: null, confidence: 0,
            rejected_boundary: raw.boundary, rejected_geometry_mode: 'dark_component',
            rejected_reasons: ['candidate_outside_scan_roi'],
            warnings: [...baseline.warnings, 'pixel_candidate_incomplete_scan', 'candidate_outside_scan_roi'],
            diagnostics: { ...baseline.diagnostics, filled_candidate_route: 'rejected_incomplete_pixel_candidate' } };
    }
    const result = evaluated.result;
    return { ...result, scan: baseline.scan,
        seed_relation: pointInPolygon(seed, result.boundary) ? 'enclosed'
            : distanceToBoundary(seed, result.boundary) <= 3 ? 'on_marker' : 'near_marker',
        marker_area_px: Math.round(result.area_px), marker_bbox: result.bbox,
        warnings: [...result.warnings, 'recovered_pixel_boundary_validated'],
        diagnostics: { ...result.diagnostics, filled_candidate_route: 'validated_recovered_pixel_boundary',
            filled_candidate_color_difference: evaluated.features?.difference,
            filled_candidate_snr: evaluated.features?.snr,
            filled_candidate_narrow_wide_ratio: evaluated.features?.narrowWideEdgeRatio } };
}

/** 正式入口：先执行既有分割与门禁，再对少数强核心恢复分支补原像素复核。 */
export async function refineFilledCandidate(
    image: MarkerImageData, seed: MarkerPoint, options: ControlledMarkerOptions,
    baseline: ControlledMarkerDetection,
): Promise<ControlledMarkerDetection> {
    const result = await refineFilledCandidateBaseline(image, seed, options, baseline);
    return refineRecoveredPixelBoundary(image, seed, options, result);
}
