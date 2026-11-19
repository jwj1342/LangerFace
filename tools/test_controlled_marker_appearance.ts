import assert from 'node:assert/strict';
import { __appearanceGeometryForTests as geometry, refineAppearanceCandidate } from '../web/src/services/controlledMarkerAppearanceCandidate.ts';
import { __controlledMarkerColorForTests as colorGeometry } from '../web/src/services/controlledMarkerDetectionColorV035.ts';
import { detectControlledMarkerWithProfile, detectControlledMarkerWithProfileAsync } from '../web/src/services/controlledMarkerDetectionProfile.ts';
import type { MarkerPoint } from '../web/src/services/controlledMarkerDetection.ts';

const square = (x: number, y: number, size: number): MarkerPoint[] => [
    { x, y }, { x: x + size, y }, { x: x + size, y: y + size }, { x, y: y + size },
];
const near = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 1e-7, `${actual} != ${expected}`);
const distantPeaks = Array.from({ length: 8 }, (_, i) => ({ x: 100 + i * 20, y: 100 }));
const nearPeak = { x: 8, y: 4 };
const assigned = geometry.pigmentAnchors([...distantPeaks, nearPeak], { x: 0, y: 0 });
assert.deepEqual(assigned.slice(0, 8), distantPeaks, 'preserve the original strong-feature search');
assert.ok(assigned.includes(nearPeak), 'a near-click image feature survives distant stronger peaks');
assert.equal(assigned.length, 9, 'repeated peaks cannot consume the supplemental budget');
assert.ok(!assigned.some(p => p.x === 0 && p.y === 0), 'the click itself is not a fabricated foreground feature');
assert.deepEqual(geometry.pigmentAnchors([], { x: 0, y: 0 }), []);
const a = square(10, 20, 20);
const compactProposal = (boundary: MarkerPoint[], anchorX: number, context: number, rankScore: number) => ({
    candidate: {
        boundary, center: geometry.polygonCentroid(boundary), major: 10, ratio: 1, angle: 0,
        score: rankScore, rankScore, anchor: { x: anchorX, y: 20 }, context,
    },
    evidence: { interiorSupport: 1, outerContinuation: 0, sectorContinuation: Array(8).fill(0) },
});
const compactPrimary = compactProposal(a, 10, 24, 10);
const compactRepeated = compactProposal(a, 20, 32, 9);
const compactUnpairedNeighbor = compactProposal(square(40, 20, 10), 40, 24, 8);
assert.ok(geometry.selectCompactPigmentProposal([compactPrimary, compactRepeated]),
    'the same object supported at separate anchors remains eligible');
assert.equal(geometry.selectCompactPigmentProposal([compactPrimary]), null,
    'one unsupported object cannot become a recovery');
assert.equal(geometry.selectCompactPigmentProposal([
    compactPrimary, compactRepeated, compactUnpairedNeighbor,
]), null, 'a distinct object without its own repeated support still vetoes recovery');
assert.ok(geometry.selectCompactPigmentProposal([
    compactPrimary, compactRepeated, compactProposal(square(11, 20, 20), 30, 24, 8),
]), 'near-overlapping estimates of one object are not separate objects');
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
const localReference = { ok: true, geometry_mode: 'dark_component', boundary: square(10, 10, 8),
    center: { x: 14, y: 14 }, area_px: 64 } as any;
const normalizedFragment = { ...localReference, boundary: square(16, 16, 8),
    center: { x: 20, y: 20 }, warnings: ['brightness_normalized_recovery'] };
const repeatedSmallBody = (boundary: MarkerPoint[], anchorX: number, complete = true) => ({
    boundary, score: 100, scanComplete: complete, evidence: { anchor: { x: anchorX, y: 20 }, context: 24 },
});
const repeatedBodyA = repeatedSmallBody(square(13, 13, 14), 12);
const repeatedBodyB = repeatedSmallBody(square(13.2, 13, 14), 28);
assert.ok(geometry.findNormalizedFragmentConflict([repeatedBodyA, repeatedBodyB], normalizedFragment),
    'separate windows can expose a larger body around an accepted normalized fragment');
assert.equal(geometry.findNormalizedFragmentConflict([repeatedBodyA], normalizedFragment), null,
    'one proposal cannot establish a repeated body conflict');
assert.equal(geometry.findNormalizedFragmentConflict([
    repeatedBodyA, { ...repeatedBodyB, evidence: repeatedBodyA.evidence },
], normalizedFragment), null, 'same-anchor scale repeats are not independent source windows');
assert.ok(geometry.findNormalizedFragmentConflict([
    repeatedBodyA, { ...repeatedBodyB, scanComplete: false },
], normalizedFragment), 'incomplete larger bodies remain counterevidence; they never certify a new outline');
assert.equal(geometry.findNormalizedFragmentConflict([
    repeatedBodyA, repeatedSmallBody(square(14.5, 13, 14), 28),
], normalizedFragment), null, 'unstable body outlines cannot broaden the fragment');
assert.ok(geometry.findNormalizedFragmentConflict([
    repeatedBodyA, repeatedBodyB, repeatedSmallBody(square(40, 40, 14), 40),
], normalizedFragment), 'an unrelated object cannot erase an already evidenced local conflict');
assert.equal(geometry.findNormalizedFragmentConflict([
    repeatedSmallBody(square(40, 40, 14), 12), repeatedSmallBody(square(40.2, 40, 14), 28),
], normalizedFragment), null, 'an unrelated repeated body cannot reject the local target');
assert.equal(geometry.findNormalizedFragmentConflict([
    repeatedBodyA, repeatedSmallBody(square(13.2, 13, 14), 20),
], normalizedFragment), null, 'a source-window gap below twelve pixels cannot certify a conflict');
const fragmentReference = { ...normalizedFragment, boundary: square(93, 93, 14),
    center: { x: 100, y: 100 }, area_px: 196 };
const evidenceImage = { width: 240, height: 240, data: new Uint8ClampedArray(0) };
const completeFragmentBody = (size: number, context: number, anchorX: number, dx = 0) => ({
    boundary: square(100 - size / 2 + dx, 100 - size / 2, size), score: 6,
    scanComplete: true, evidence: { diameter: size, context, anchor: { x: anchorX, y: 96 } },
});
const supportedBodyA = completeFragmentBody(30, 24, 92);
const supportedBodyB = completeFragmentBody(30, 32, 108);
const supportedBank = [supportedBodyA, supportedBodyB, completeFragmentBody(24, 24, 100)];
const bankBefore = structuredClone(supportedBank);
const recoveredBody = geometry.selectCompleteFragmentBody(supportedBank, fragmentReference, evidenceImage);
assert.ok(recoveredBody, 'a complete corroborated body may replace a known conflicting fragment');
near(geometry.polygonArea(recoveredBody.boundary), 900);
assert.equal((recoveredBody.evidence.fragmentBodySupport as any).kind, 'cross_context_and_distinct_anchor');
assert.deepEqual(supportedBank, bankBefore, 'selection does not mutate the proposal bank');
assert.equal(geometry.selectCompleteFragmentBody([], fragmentReference, evidenceImage), null);
for (const counterexample of [
    [...supportedBank, { ...supportedBodyB, scanComplete: false }],
    supportedBank.map(body => ({ ...body, evidence: { ...body.evidence, context: 24 } })),
    supportedBank.map(body => ({ ...body, evidence: { ...body.evidence, anchor: { x: 100, y: 96 } } })),
    [...supportedBank, completeFragmentBody(30, 24, 137, 45)],
    [...supportedBank, completeFragmentBody(30, 24, 97, 5)],
    [...supportedBank, completeFragmentBody(30, 24, 97, 5), completeFragmentBody(30, 32, 113, 5)],
    [...supportedBank, completeFragmentBody(30, 24, 97, 2)],
    [...supportedBank, completeFragmentBody(30, 24, 92, 2), completeFragmentBody(30, 32, 108, 2)],
    [...supportedBank, completeFragmentBody(34, 24, 100)],
    [...supportedBank, completeFragmentBody(45, 24, 100)],
]) assert.equal(geometry.selectCompleteFragmentBody(counterexample, fragmentReference, evidenceImage), null,
    'incomplete, contradictory, unpaired outer extent and insufficient support cannot be filtered away');
assert.ok(geometry.selectCompleteFragmentBody(
    [...supportedBank, completeFragmentBody(30, 24, 97, 1)], fragmentReference, evidenceImage),
    'a minor unpaired edge drift within five percent does not veto a corroborated body');
assert.equal(geometry.selectCompleteFragmentBody(supportedBank, fragmentReference,
    { ...evidenceImage, width: 120 }), null, 'a clipped background cannot certify a new accepted body');
const extensionCore = Array.from({ length: 100 }, (_, i) => ({
    u: i < 40 ? 0 : 2, v: 0, c: [0, 0, 0] as [number, number, number],
}));
const extensionResiduals = extensionCore.map((_, i) =>
    [i < 76 ? 5 : 0, 0, 0] as [number, number, number]);
assert.ok(extensionResiduals.filter(v => v[0] >= 2).length / 100 >= .7,
    'the whole core can pass even when the newly added region is weak');
assert.equal(geometry.fragmentExtensionEvidence(extensionCore, extensionResiduals,
    v => v[0], 5, { x: 0, y: 0 }, 1, square(-1, -1, 2)), null,
    'old dark pixels must not supply the added region support');
const supportedExtension = extensionResiduals.map((v, i) =>
    [i < 82 ? 5 : 0, v[1], v[2]] as [number, number, number]);
assert.equal(geometry.fragmentExtensionEvidence(extensionCore, supportedExtension,
    v => v[0], 5, { x: 0, y: 0 }, 1, square(-1, -1, 2))?.addedCoreSupport, .7,
    'support uses the added region denominator and the same field projection');
const remoteShadow = bodyCandidate(square(100, 100, 40), 1000);
const enclosingIncomplete = { ...bodyCandidate(square(5, 5, 30), 200), scanComplete: false };
assert.deepEqual(geometry.associateBodyCandidates([remoteShadow, fullBodyA], localReference), [fullBodyA],
    'a remote shadow must not win or veto an already supported local object');
assert.deepEqual(geometry.associateBodyCandidates([enclosingIncomplete], localReference), [enclosingIncomplete],
    'a larger body containing the local fragment must retain its incomplete-scan veto');
assert.deepEqual(geometry.associateBodyCandidates([remoteShadow], localReference), [],
    'no related body is not evidence that the scan is incomplete');
assert.deepEqual(geometry.associateBodyCandidates([remoteShadow], { ...localReference, ok: false }), [remoteShadow],
    'an unsupported reference cannot suppress independent body discovery');
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
const associatedBaseline = { ...localReference,
    diagnostics: { filled_candidate_route: 'validated_legacy_filled_candidate' } } as any;
const isolatedPigment = compactProposal(square(8, 8, 12), 12, 64, 10);
const enclosingMaterial = square(5, 5, 18);
assert.equal(geometry.preserveAssociatedPigmentCandidate(associatedBaseline,
    isolatedPigment, enclosingMaterial, { x: 14, y: 14 }), true,
    'an already associated local object may survive inside a complete larger body');
for (const reference of [
    { ...associatedBaseline, ok: false, boundary: [], area_px: 0 },
    { ...associatedBaseline, diagnostics: { filled_candidate_route: 'validated_recovered_pixel_boundary' } },
    { ...associatedBaseline, boundary: square(7, 10, 8) },
]) assert.equal(geometry.preserveAssociatedPigmentCandidate(reference,
    isolatedPigment, enclosingMaterial, { x: 14, y: 14 }), false,
    'rejected, other-source and incompletely contained baselines retain the original result');
assert.equal(geometry.preserveAssociatedPigmentCandidate(associatedBaseline,
    isolatedPigment, square(10, 10, 10), { x: 14, y: 14 }), false,
    'a partial or different body cannot corroborate the complete local outline');
assert.equal(geometry.preserveAssociatedPigmentCandidate(associatedBaseline,
    isolatedPigment, enclosingMaterial, { x: 21, y: 14 }), false,
    'a neighboring object cannot replace the clicked target');
for (const evidence of [
    { ...isolatedPigment.evidence, outerContinuation: .01 },
    { ...isolatedPigment.evidence, sectorContinuation: [0, 0, 0, .01, 0, 0, 0, 0] },
    { ...isolatedPigment.evidence, sectorContinuation: [0, 0] },
]) assert.equal(geometry.preserveAssociatedPigmentCandidate(associatedBaseline,
    { ...isolatedPigment, evidence }, enclosingMaterial, { x: 14, y: 14 }), false,
    'an outward continuation or missing sector preserves the original selection');
const relativeBaseline = { ...associatedBaseline, boundary: square(12, 12, 4), area_px: 16,
    diagnostics: { filled_candidate_route: 'relative_color_filled_candidate' } } as any;
const repeatedRecovery = { proposal: isolatedPigment, support: {
    kind: 'separate_anchors' as const, anchor: { x: 12, y: 12 }, context: 64,
    peerAnchor: { x: 24, y: 12 }, peerContext: 48, overlapIou: 1,
} };
const corroborate = geometry.corroborateContainedPigmentCandidate;
assert.equal(corroborate(relativeBaseline, isolatedPigment, enclosingMaterial,
    { x: 14, y: 14 }, () => repeatedRecovery), repeatedRecovery,
    'repeated independent support can corroborate an existing local outline beyond the tiny baseline ratio');
for (const reference of [
    { ...relativeBaseline, ok: false },
    { ...relativeBaseline, geometry_mode: 'enclosed_region' },
    associatedBaseline,
    { ...relativeBaseline, boundary: square(7, 12, 4) },
    { ...relativeBaseline, boundary: [] },
]) assert.equal(corroborate(reference, isolatedPigment, enclosingMaterial,
    { x: 14, y: 14 }, () => repeatedRecovery), null);
for (const evidence of [
    { ...isolatedPigment.evidence, outerContinuation: .01 },
    { ...isolatedPigment.evidence, sectorContinuation: [0, 0, .01, 0, 0, 0, 0, 0] },
    { ...isolatedPigment.evidence, sectorContinuation: [] },
]) assert.equal(corroborate(relativeBaseline, { ...isolatedPigment, evidence }, enclosingMaterial,
    { x: 14, y: 14 }, () => repeatedRecovery), null);
assert.equal(corroborate(relativeBaseline, isolatedPigment, square(10, 10, 10),
    { x: 14, y: 14 }, () => repeatedRecovery), null, 'partial enclosing body is insufficient');
assert.equal(corroborate(relativeBaseline, isolatedPigment, enclosingMaterial,
    { x: 21, y: 14 }, () => repeatedRecovery), null, 'the clicked object must be inside the local outline');
assert.equal(corroborate(relativeBaseline, isolatedPigment, isolatedPigment.candidate.boundary,
    { x: 14, y: 14 }, () => repeatedRecovery), null, 'the enclosing body must be strictly larger');
for (const recovery of [null, { ...repeatedRecovery,
    proposal: compactProposal(square(9, 8, 12), 12, 64, 10) }]) {
    assert.equal(corroborate(relativeBaseline, isolatedPigment, enclosingMaterial,
        { x: 14, y: 14 }, () => recovery), null,
        'missing or equal-area shifted recovery cannot replace the existing outline');
}
assert.equal(corroborate(relativeBaseline, isolatedPigment, enclosingMaterial,
    { x: 14, y: 14 }, () => { throw new Error('optional recovery unavailable'); }), null,
    'an optional recovery error preserves the prior selection');
let rejectedRecoveryCalls = 0;
assert.equal(corroborate(associatedBaseline, isolatedPigment, enclosingMaterial,
    { x: 14, y: 14 }, () => { rejectedRecoveryCalls++; return repeatedRecovery; }), null);
assert.equal(rejectedRecoveryCalls, 0, 'ineligible sources never run the extra recovery');
const acceptedLocal = { ...relativeBaseline, boundary: isolatedPigment.candidate.boundary,
    area_px: 144, diagnostics: { filled_candidate_route: 'localized_pigment_envelope' } } as any;
const largerRelativeBaseline = { ...relativeBaseline, boundary: square(10, 10, 8), area_px: 64 };
assert.equal(corroborate(largerRelativeBaseline, isolatedPigment, enclosingMaterial,
    { x: 14, y: 14 }, () => repeatedRecovery), null,
    'a ratio at most four cannot bypass an unsuccessful original association');
assert.equal(corroborate(largerRelativeBaseline, isolatedPigment, enclosingMaterial,
    { x: 14, y: 14 }, () => repeatedRecovery, acceptedLocal), repeatedRecovery,
    'an already associated local outline retains independent corroboration');
const gradualFallback = { ...relativeBaseline, ok: false, boundary: [], area_px: 0,
    failure_code: 'unstable_enclosure', rejected_boundary: relativeBaseline.boundary,
    rejected_geometry_mode: 'dark_component', rejected_reasons: ['gradual_shading_edge'],
    diagnostics: { filled_candidate_route: 'reject_unverified_filled_fallback' } } as any;
assert.equal(corroborate(gradualFallback, isolatedPigment, enclosingMaterial,
    { x: 14, y: 14 }, () => repeatedRecovery, acceptedLocal), repeatedRecovery,
    'an already accepted identical local outline can survive a larger material replacement');
for (const reference of [
    { ...gradualFallback, failure_code: 'scan_range_too_small' },
    { ...gradualFallback, rejected_reasons: ['not_enclosed_within_scan'] },
    { ...gradualFallback, rejected_reasons: ['gradual_shading_edge', 'noncompact_or_thin'] },
    { ...gradualFallback, rejected_boundary: square(7, 12, 4) },
]) assert.equal(corroborate(reference, isolatedPigment, enclosingMaterial,
    { x: 14, y: 14 }, () => repeatedRecovery, acceptedLocal), null);
for (const local of [undefined, { ...acceptedLocal, ok: false },
    { ...acceptedLocal, boundary: square(9, 8, 12) }]) {
    assert.equal(corroborate(gradualFallback, isolatedPigment, enclosingMaterial,
        { x: 14, y: 14 }, () => repeatedRecovery, local), null,
        'a rejected input needs the same previously accepted local outline');
}
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
        if (kind === 'small-solid' && r <= 8) color = [110, 70, 50];
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
const smallOutline = Array.from({ length: 64 }, (_, i) => ({
    x: 160 + 8 * Math.cos(i * Math.PI / 32), y: 160 + 8 * Math.sin(i * Math.PI / 32),
}));
const normalizedSmall = { ...normalizedFragment, boundary: smallOutline, center: seed,
    area_px: geometry.polygonArea(smallOutline), scan: { radius_px: 36 } } as any;
for (const kind of ['small-solid', 'blank', 'hair', 'hollow']) {
    const result = await geometry.rejectNormalizedFragmentConflict(image(kind), seed,
        { ...options, roiRadius: 36 }, normalizedSmall);
    assert.equal(result, normalizedSmall, `${kind}: no repeated filled-body evidence cannot veto a local result`);
}
const blank = image('blank');
const alternateSmall = { ...normalizedSmall,
    warnings: ['color_difference_fragment_neighborhood_consensus_recovered'] };
for (const kind of ['small-solid', 'blank', 'hair', 'hollow']) {
    assert.equal(await geometry.rejectNormalizedFragmentConflict(image(kind), seed,
        { ...options, roiRadius: 36 }, alternateSmall, false), alternateSmall,
        `${kind}: conflict-only recheck preserves an isolated local result`);
}
const alternateUnavailable = { ...alternateSmall,
    warnings: [...alternateSmall.warnings, 'appearance_refinement_unavailable'] };
assert.equal(await refineAppearanceCandidate(blank, seed,
    { ...options, roiRadius: 36 }, alternateUnavailable), alternateUnavailable,
    'unavailable alternate recovery cannot enter the conflict-only recheck');
const unavailableFragment = { ...normalizedSmall, warnings: [
    'brightness_normalized_recovery', 'appearance_refinement_unavailable',
] };
assert.equal(await refineAppearanceCandidate(blank, seed,
    { ...options, roiRadius: 36 }, unavailableFragment), unavailableFragment,
    'a prior unavailable result must be preserved by the new wrapper');
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
