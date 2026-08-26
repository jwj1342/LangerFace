#!/usr/bin/env python3

import json
import sys

import cv2
import numpy as np


def color_mask(image, target_rgb, tolerance):
    target_bgr = np.array(target_rgb[::-1], dtype=np.int16)
    difference = image.astype(np.int16) - target_bgr
    return np.max(np.abs(difference), axis=2) <= tolerance


def transform_pixels(mask, homography):
    y, x = np.nonzero(mask)
    points = np.column_stack([x, y]).astype(np.float32).reshape(-1, 1, 2)
    return cv2.perspectiveTransform(points, homography).reshape(-1, 2)


def minimum_distances(points, targets):
    if not len(points) or not len(targets):
        return np.full(len(points), np.inf)
    matcher = cv2.FlannBasedMatcher(dict(algorithm=1, trees=8), dict(checks=64))
    matches = matcher.match(points.astype(np.float32), targets.astype(np.float32))
    return np.array([match.distance for match in matches])


def main():
    annotation_path, reference_path, refinement_path = sys.argv[1:4]
    annotation = cv2.imread(annotation_path)
    reference = cv2.imread(reference_path)
    if annotation is None or reference is None:
        raise SystemExit("failed to read annotation or reference image")

    sift = cv2.SIFT_create(nfeatures=12_000)
    annotation_keypoints, annotation_descriptors = sift.detectAndCompute(
        cv2.cvtColor(annotation, cv2.COLOR_BGR2GRAY), None
    )
    reference_keypoints, reference_descriptors = sift.detectAndCompute(
        cv2.cvtColor(reference, cv2.COLOR_BGR2GRAY), None
    )
    matcher = cv2.BFMatcher(cv2.NORM_L2)
    pairs = matcher.knnMatch(annotation_descriptors, reference_descriptors, k=2)
    matches = [first for first, second in pairs if first.distance < 0.68 * second.distance]
    source = np.float32([annotation_keypoints[match.queryIdx].pt for match in matches])
    target = np.float32([reference_keypoints[match.trainIdx].pt for match in matches])
    homography, inliers = cv2.findHomography(source, target, cv2.RANSAC, 2.0)
    if homography is None:
        raise SystemExit("annotation registration failed")

    red = transform_pixels(color_mask(annotation, (255, 82, 82), 30), homography)
    blue = transform_pixels(color_mask(annotation, (39, 169, 255), 35), homography)
    green = transform_pixels(color_mask(annotation, (31, 190, 93), 35), homography)
    with open(refinement_path, encoding="utf-8") as file:
        refinement = json.load(file)

    records = []
    for curve_index, line in enumerate(refinement["lines"]):
        points = np.asarray(line["points_xy"], dtype=np.float32)
        red_distances = minimum_distances(points, red)
        blue_distances = minimum_distances(points, blue)
        records.append({
            "curveIndex": curve_index,
            "name": line["name"],
            "region": line["region"],
            "redMinimumPx": float(red_distances.min()),
            "redPointIndicesWithin5Px": np.flatnonzero(red_distances <= 5).tolist(),
            "blueMinimumPx": float(blue_distances.min()),
            "bluePointIndicesWithin5Px": np.flatnonzero(blue_distances <= 5).tolist(),
        })

    output = {
        "registration": {
            "matchCount": len(matches),
            "inlierCount": int(inliers.sum()),
            "homographyAnnotationToWorking": homography.tolist(),
        },
        "annotationBoundsWorking": {
            name: {
                "minX": float(points[:, 0].min()),
                "minY": float(points[:, 1].min()),
                "maxX": float(points[:, 0].max()),
                "maxY": float(points[:, 1].max()),
                "pixelCount": len(points),
            }
            for name, points in (("red", red), ("blue", blue), ("green", green))
        },
        "closestRedCurves": sorted(records, key=lambda record: record["redMinimumPx"])[:20],
        "closestBlueCurves": sorted(records, key=lambda record: record["blueMinimumPx"])[:10],
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
