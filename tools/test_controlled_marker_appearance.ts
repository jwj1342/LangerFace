import assert from 'node:assert/strict';
import { __appearanceGeometryForTests as geometry, refineAppearanceCandidate } from '../web/src/services/controlledMarkerAppearanceCandidate.ts';
import { __controlledMarkerColorForTests as colorGeometry } from '../web/src/services/controlledMarkerDetectionColorV035.ts';
import { detectControlledMarkerWithProfile, detectControlledMarkerWithProfileAsync } from '../web/src/services/controlledMarkerDetectionProfile.ts';
import type { MarkerPoint } from '../web/src/services/controlledMarkerDetection.ts';

const square = (x: number, y: number, size: number): MarkerPoint[] => [
    { x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size },
];
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
const a = square(10, 20, 20);
near(geometry.convexIntersectionArea(a, a), 400);
near(geometry.convexIntersectionArea(a, a.slice().reverse()), 400);
near(geometry.convexIntersectionArea(a, [...a.slice(2), ...a.slice(0, 2)]), 400);
near(geometry.convexIntersectionArea(a, square(30, 20, 20)), 0);
near(geometry.convexIntersectionArea(a, square(20, 20, 20)), 200);
near(geometry.convexIntersectionArea(a, square(12, 22, 10)), 100);
assert.deepEqual(geometry.polygonCentroid(a), { x: 20, y: 30 });
assert.deepEqual(geometry.polygonCentroid(a.slice().reverse()), { x: 20, y: 30 });
const denseEdge = [a[0], { x: 12, y: 20 }, { x: 13, y: 20 }, { x: 14, y: 20 }, ...a.slice(1)];
assert.deepEqual(geometry.polygonCentroid(denseEdge), { x: 20, y: 30 }, 'vertex density cannot move the area centroid');
near(geometry.convexIntersectionArea(denseEdge, a), 400);

const bodyCandidate = (boundary: MarkerPoint[], score: number) => ({
    boundary, score, scanComplete: true, evidence: {},
});
const smallFragment = { ...bodyCandidate(square(21, 21, 8), 100), evidence: { anchor: { x: 28, y: 28 } } };
const fullBodyA = { ...bodyCandidate(square(10, 10, 10), 90), evidence: { anchor: { x: 15, y: 15 } } };
const fullBodyB = { ...bodyCandidate(square(10.5, 10.5, 10), 80), evidence: { anchor: { x: 16, y: 16 } } };
assert.equal(geometry.selectCompleteBodyCandidate([smallFragment, fullBodyA, fullBodyB]), fullBodyA,
    'a much smaller high-score fragment must yield to the repeated full-body candidate');
const closeSizeWinner = bodyCandidate(square(10, 10, 9), 100);
const closeSizePeer = bodyCandidate(square(10, 10, 10), 90);
assert.equal(geometry.selectCompleteBodyCandidate([closeSizeWinner, closeSizePeer]), closeSizeWinner,
    'ordinary score ranking remains unchanged when candidates are close in size');
const sameAnchorSmall = { ...bodyCandidate(square(10, 10, 8), 100), evidence: { anchor: { x: 20, y: 20 } } };
const sameAnchorLarge = { ...bodyCandidate(square(10, 10, 12), 90), evidence: { anchor: { x: 20, y: 20 } } };
assert.equal(geometry.selectCompleteBodyCandidate([sameAnchorSmall, sameAnchorLarge]), sameAnchorSmall,
    'same-anchor scale changes must not become a new body');
const baselineBoundary = square(100, 100, 20);
const expandedBoundary = square(94, 94, 32);
const constrained = geometry.constrainAppearanceExpansion({
    ok: true,
    geometry_mode: 'dark_component',
    boundary: baselineBoundary,
    area_px: 400,
} as any, expandedBoundary, 'material_body_envelope');
assert.ok(constrained.cap, 'a large appearance expansion records a bounded cap');
near(geometry.polygonArea(constrained.boundary) / 400, 1.4);
const unchanged = geometry.constrainAppearanceExpansion({
    ok: true,
    geometry_mode: 'dark_component',
    boundary: baselineBoundary,
    area_px: 400,
} as any, square(100, 100, 22), 'material_body_envelope');
near(geometry.polygonArea(unchanged.boundary), 484 * 0.92 * 0.92);
const directional = geometry.constrainAppearanceExpansion({
    ok: true,
    geometry_mode: 'dark_component',
    boundary: baselineBoundary,
    area_px: 400,
} as any, expandedBoundary, 'material_body_envelope', {
    sectorMedianProjection: [12, 12, 12, 12, 0.2, 0.2, 0.2, 0.2],
});
assert.ok(directional.boundary[1].x < constrained.boundary[1].x,
    'weakly supported sectors retain the conservative inward shrink');
assert.ok(directional.boundary[2].x > constrained.boundary[2].x,
    'strongly supported sectors preserve more of a locally evidenced edge');
const tinyRecoveredBoundary = Array.from({ length: 32 }, (_, index) => {
    const angle = 2 * Math.PI * index / 32;
    return { x: 30 + Math.cos(angle) * 6, y: 40 + Math.sin(angle) * 5 };
});
const tinyRecovered = {
    ok: true,
    geometry_mode: 'dark_component',
    boundary: tinyRecoveredBoundary,
    area_px: 90,
    center: { x: 30, y: 40 },
    warnings: ['scan_solid_core_anchor_recovered'],
    diagnostics: {
        filled_candidate_route: 'validated_legacy_filled_candidate',
        solid_component_core_dark_ratio: 0.98,
        scan_solid_proposal_core_dark_ratio: 0.98,
        scan_solid_proposal_consensus_count: 4,
    },
} as any;
const preservedTiny = colorGeometry.regularizeSolidBoundary(tinyRecovered);
assert.deepEqual(preservedTiny.boundary, tinyRecoveredBoundary,
    'a small strong-core recovered boundary keeps its source-pixel outline');
assert.ok(preservedTiny.warnings.includes('small_recovered_pixel_boundary_preserved'),
    'small recovered pixel preservation is explicit in diagnostics');

function image(kind: string) {
    const width = 320, height = 320, data = new Uint8ClampedArray(width * height * 4);
    let state = 91723;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
        const noise = ((state >>> 24) / 255 - .5) * 3, dx = x - 160, dy = y - 160, r = Math.hypot(dx, dy);
        let color = [205, 175, 149];
        if (kind === 'solid' && r <= 18 || kind === 'hollow' && r >= 14 && r <= 18) color = [110, 70, 50];
        if (kind === 'body' && r <= 36) color = r <= 5 ? [110, 70, 50] : [185, 144, 121];
        if (kind === 'hair' && Math.abs(dx + .4 * dy) < 2) color = [35, 30, 27];
        if (kind === 'arc' && r >= 32 && r <= 36 && Math.atan2(dy, dx) > -.3 && Math.atan2(dy, dx) < 2.7) color = [110, 70, 50];
        if (kind === 'strip' && Math.hypot(dx / 10, dy / 60) <= 1) color = [175, 130, 112];
        const at = (y * width + x) * 4;
        for (let k = 0; k < 3; k++) data[at + k] = color[k] + noise;
        data[at + 3] = 255;
    }
    return { width, height, data };
}

const seed = { x: 160, y: 160 }, options = { roiRadius: 100, analysisRoiRadius: 36, scanDiameterMm: 20 };
const blank = image('blank');
const baseline = detectControlledMarkerWithProfile('small-lesion-boundary-candidate', blank, seed, options);
for (const invalid of [{ ...blank, data: new Uint8ClampedArray(0) }, { ...blank, width: 0 }])
    assert.equal(await refineAppearanceCandidate(invalid, seed, options, baseline), baseline);
assert.equal(await refineAppearanceCandidate(blank, { x: NaN, y: 160 }, options, baseline), baseline);
const invalidRadiusBaseline = { ...baseline, scan: undefined };
assert.equal(await refineAppearanceCandidate(blank, seed, { roiRadius: 1000 }, invalidRadiusBaseline), invalidRadiusBaseline);
const pen = { ...baseline, ok: true, geometry_mode: 'enclosed_region' as const };
assert.equal(await refineAppearanceCandidate(blank, seed, options, pen), pen, 'existing pen path is not refined');
const large = { ...baseline, ok: true, geometry_mode: 'dark_component' as const, area_px: 3000 };
assert.equal(await refineAppearanceCandidate(blank, seed, options, large), large, 'large accepted baseline remains unchanged');

for (const kind of ['solid', 'hollow', 'body', 'blank', 'hair', 'arc', 'strip']) {
    const result = await detectControlledMarkerWithProfileAsync('small-lesion-boundary-candidate', image(kind), seed, options);
    const positive = ['solid', 'hollow', 'body'].includes(kind);
    assert.equal(result.ok, positive, `${kind}: actual asynchronous entry`);
    if (positive) {
        assert.ok(result.boundary.length >= 3);
        assert.ok(result.boundary.every(p => Math.hypot(p.x - seed.x, p.y - seed.y) <= 95));
        assert.ok(result.area_px >= (kind === 'body' ? 2500 : 450), `${kind}: cannot report only a dark core`);
        assert.ok(result.area_px <= (kind === 'body' ? 6000 : 1500));
        // An enclosed pen result keeps stroke pixels separate from inner area.
        if (result.geometry_mode === 'dark_component') {
            assert.equal(result.marker_area_px, Math.round(result.area_px));
            assert.deepEqual(result.marker_bbox, result.bbox);
        }
    }
}
console.log('appearance geometry, exclusions, whole-body recovery and asynchronous counterexamples passed');
