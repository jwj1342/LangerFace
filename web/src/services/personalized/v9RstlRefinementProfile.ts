import type { V6RefinementOptions } from "./v6RstlRefinementV9.ts";

export const LATEST_WRINKLE_REFINEMENT_PROFILE =
  "v9-regional-smooth-7.2";

export const YOLO_GUIDED_WRINKLE_REFINEMENT_PROFILE =
  "v9-regional-smooth-7.2-yolo-guided-glabellar";

/** Shared V9 profile used by the deployed live page and the controlled experiment. */
export function latestV9RstlRefinementOptions(
  faceWidthPx: number,
): V6RefinementOptions {
  if (!(faceWidthPx > 0)) throw new Error("faceWidthPx must be positive");
  return {
    twoSidedNearestMatching: true,
    foreheadNearestSingleCurveMatching: true,
    regionalNearestSingleCurveMatching: true,
    regionalCandidateFamilyFiltering: true,
    nearestSingleCurveMatching: false,
    exclusiveTrendMatching: false,
    oneToOneTrendCurveMatching: false,
    searchRadiusPx: faceWidthPx * 0.110,
    logicalTrendGrouping: true,
    softLinkDistancePx: faceWidthPx * 0.030,
    softLinkTurnDegrees: 18,
    softLinkTangentSpanPx: Math.round(faceWidthPx * 0.020),
    globalLengthAwareMatching: true,
    adherenceRetryAttempts: 10,
    shortWrinkleQuantizationTolerance: true,
    shortWrinkleMaximumLengthRatio: 0.12,
    shortWrinkleP90TolerancePx: Math.max(0.5, faceWidthPx * 0.001),
    adherenceDirectionSoftDegrees: 25,
    adherenceDirectionHardDegrees: 40,
    topologyRetryAttempts: 3,
    postAdherenceGate: true,
    targetGapPx: Math.max(0.75, faceWidthPx * 0.0012),
    dataAttractionStrength: 20,
    wrinkleDominantCoreStrength: 0.95,
    wrinkleDominantCoreSupportRatio: 0.08,
    smoothingPasses: 12,
    transitionLengthPx: faceWidthPx * 0.040,
    p90LimitPx: faceWidthPx * 0.030,
    maxDisplacementPx: faceWidthPx * 0.045,
    maxCurvatureChangeDegrees: 60,
    curvatureFairing: true,
    curvatureFairingPasses: 64,
    curvatureFairingMaximumTurnDegrees: 4,
    curvatureFairingStrictMaximumTurnDegrees: 3,
    curvatureFairingBaselineSlackDegrees: 0.75,
    curvatureFairingMaterialTurnDegrees: 0.35,
    curvatureFairingMaximumAddedSignChanges: 0,
    curvatureFairingForeheadMaximumAddedSignChanges: 4,
    curvatureFairingEndpointTangentChangeDegrees: 20,
    curvatureFairingMaximumMeanAdherencePx: Math.max(2, faceWidthPx * 0.0035),
    curvatureFairingMaximumP90AdherencePx: Math.max(4, faceWidthPx * 0.0065),
    curvatureFairingForeheadMaximumTurnDegrees: 8,
    curvatureFairingForeheadMaximumMeanAdherencePx: 1.5,
    curvatureFairingForeheadMaximumP90AdherencePx: 3,
    foreheadAdherenceMeanThresholdPx: 1.5,
    foreheadAdherenceP90ThresholdPx: 3,
    foreheadBundleCoherence: true,
    foreheadBundleMinimumSpacingRatio: 0.65,
    foreheadBundleMaximumSpacingRatio: 1.45,
    foreheadBundleMaximumTurnDegrees: 8,
    foreheadBundleMaximumAddedSignChanges: 6,
    foreheadBundleMinimumReversalSpacingPx: 12,
    curvatureFairingGlabellarMaximumTurnDegrees: 8,
    curvatureFairingGlabellarMaximumAddedSignChanges: 4,
    curvatureFairingGlabellarMaximumMeanAdherencePx: 2.6,
    curvatureFairingGlabellarMaximumP90AdherencePx: 7,
    curvatureFairingGlabellarMinimumReversalSpacingPx: 15,
    glabellarAdherenceMeanThresholdPx: 2.6,
    glabellarAdherenceP90ThresholdPx: 7,
    glabellarMaximumDisplacementPx: faceWidthPx * 0.08,
    glabellarTransitionLengthPx: faceWidthPx * 0.08,
    curvatureFairingCrowsFeetMaximumTurnDegrees: 9,
    curvatureFairingCrowsFeetMaximumAddedSignChanges: 2,
    curvatureFairingCrowsFeetMaximumMeanAdherencePx: 3.75,
    curvatureFairingCrowsFeetMaximumP90AdherencePx: 7,
    curvatureFairingCrowsFeetMinimumReversalSpacingPx: 10,
    curvatureFairingCrowsFeetMaximumDirectionP90Degrees: 40,
    curvatureFairingCrowsFeetDirectionWeight: 2.0,
    crowsFeetAdherenceMeanThresholdPx: 3.75,
    crowsFeetAdherenceP90ThresholdPx: 7,
    crowsFeetAdherenceDirectionP90Degrees: 40,
    crowsFeetMaximumDisplacementPx: faceWidthPx * 0.07,
    crowsFeetTransitionLengthPx: faceWidthPx * 0.06,
    crowsFeetRetainAlignedRefinement: true,
    crowsFeetNeighborCoherence: true,
    crowsFeetNeighborCountPerAnchor: 2,
    crowsFeetNeighborRadiusPx: faceWidthPx * 0.030,
    crowsFeetNeighborStrength: 0.28,
    crowsFeetNeighborMinimumSpacingRatio: 0.70,
    crowsFeetNeighborMaximumTurnDegrees: 10,
    crowsFeetDirectionalBundleMinimumPriorDirectionDegrees: 20,
    bundlePropagation: false,
  };
}

/**
 * YOLO-only photo refinement needs a wider glabellar adherence envelope than
 * the shared V9/V10 and advanced-personalization paths. Keep these overrides
 * explicit so this workflow cannot silently change other callers.
 */
export function yoloGuidedV9RstlRefinementOptions(
  faceWidthPx: number,
): V6RefinementOptions {
  return {
    ...latestV9RstlRefinementOptions(faceWidthPx),
    // Real-image ablations showed that widening adherence is the primary fix;
    // the 20° allowance adds one further safe yellow-sample match. The effective
    // turn limit remains max(20°, baseline maximum turn + 0.75°).
    curvatureFairingGlabellarMaximumTurnDegrees: 20,
    curvatureFairingGlabellarMaximumMeanAdherencePx: 3,
    curvatureFairingGlabellarMaximumP90AdherencePx: 11,
    glabellarAdherenceMeanThresholdPx: 3,
    glabellarAdherenceP90ThresholdPx: 11,
  };
}
