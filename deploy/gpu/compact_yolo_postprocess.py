"""Exact compact class-mask postprocess for the fixed 640px Live YOLO model."""
import math

import numpy as np

CLASS_COUNT = 3
MASK_CHANNELS = 32
INPUT_SIZE = 640
MASK_THRESHOLD = 0.5
CONFIDENCE_THRESHOLD = 0.07


def _iou(first, second):
    left = max(first[0], second[0])
    top = max(first[1], second[1])
    right = min(first[2], second[2])
    bottom = min(first[3], second[3])
    intersection = max(0.0, right - left) * max(0.0, bottom - top)
    first_area = max(0.0, first[2] - first[0]) * max(0.0, first[3] - first[1])
    second_area = max(0.0, second[2] - second[0]) * max(0.0, second[3] - second[1])
    union = first_area + second_area - intersection
    return intersection / union if union > 0 else 0.0


def _decode_and_nms(prediction):
    scores = prediction[4:4 + CLASS_COUNT]
    class_ids = np.argmax(scores, axis=0)
    maximum_scores = scores[class_ids, np.arange(scores.shape[1])]
    anchors = np.flatnonzero(np.isfinite(maximum_scores) &
                             (maximum_scores >= CONFIDENCE_THRESHOLD))
    candidates = []
    for anchor in anchors:
        class_id = int(class_ids[anchor])
        score = float(maximum_scores[anchor])
        cx, cy, width, height = (float(value) for value in prediction[:4, anchor])
        width = max(0.0, width)
        height = max(0.0, height)
        box = (
            min(INPUT_SIZE, max(0.0, cx - width / 2)),
            min(INPUT_SIZE, max(0.0, cy - height / 2)),
            min(INPUT_SIZE, max(0.0, cx + width / 2)),
            min(INPUT_SIZE, max(0.0, cy + height / 2)),
        )
        if box[2] <= box[0] or box[3] <= box[1]:
            continue
        candidates.append({
            'anchor': int(anchor),
            'classId': class_id,
            'score': score,
            'box': box,
            'coefficients': prediction[4 + CLASS_COUNT:, anchor].astype(np.float64),
        })
    candidates.sort(key=lambda item: -item['score'])
    kept = []
    for candidate in candidates:
        if any(other['classId'] == candidate['classId'] and
               _iou(candidate['box'], other['box']) > 0.45 for other in kept):
            continue
        kept.append(candidate)
        if len(kept) >= 100:
            break
    return candidates, kept


def compact_class_masks(outputs):
    prediction = next(value.reshape(39, 8400) for value in outputs
                      if tuple(value.shape) == (1, 39, 8400))
    prototype = next(value.reshape(32, 160, 160) for value in outputs
                     if tuple(value.shape) == (1, 32, 160, 160))
    candidates, detections = _decode_and_nms(prediction)
    coefficients = np.stack([item['coefficients'] for item in detections])
    logits = coefficients @ prototype.astype(np.float64).reshape(MASK_CHANNELS, -1)
    probabilities = np.empty_like(logits)
    positive = logits >= 0
    probabilities[positive] = 1 / (1 + np.exp(-logits[positive]))
    exponential = np.exp(logits[~positive])
    probabilities[~positive] = exponential / (1 + exponential)
    instances = probabilities.reshape(-1, 160, 160)
    masks = np.zeros((CLASS_COUNT, INPUT_SIZE, INPUT_SIZE), dtype=np.uint8)

    for detection, instance in zip(detections, instances):
        x0 = max(0, min(INPUT_SIZE - 1, math.floor(detection['box'][0])))
        y0 = max(0, min(INPUT_SIZE - 1, math.floor(detection['box'][1])))
        x1 = max(0, min(INPUT_SIZE, math.ceil(detection['box'][2])))
        y1 = max(0, min(INPUT_SIZE, math.ceil(detection['box'][3])))
        xs = np.arange(x0, x1, dtype=np.float64)
        ys = np.arange(y0, y1, dtype=np.float64)
        proto_x = np.clip((xs + 0.5) / 4 - 0.5, 0, 159)
        proto_y = np.clip((ys + 0.5) / 4 - 0.5, 0, 159)
        x_low = np.floor(proto_x).astype(np.int32)
        y_low = np.floor(proto_y).astype(np.int32)
        x_high = np.minimum(159, x_low + 1)
        y_high = np.minimum(159, y_low + 1)
        tx = proto_x - x_low
        ty = proto_y - y_low
        top = (instance[np.ix_(y_low, x_low)] * (1 - tx)[None, :] +
               instance[np.ix_(y_low, x_high)] * tx[None, :])
        bottom = (instance[np.ix_(y_high, x_low)] * (1 - tx)[None, :] +
                  instance[np.ix_(y_high, x_high)] * tx[None, :])
        sampled = top * (1 - ty)[:, None] + bottom * ty[:, None]
        masks[detection['classId'], y0:y1, x0:x1] |= sampled >= MASK_THRESHOLD

    compact_detections = [{
        'classId': item['classId'],
        'score': item['score'],
        'box': list(item['box']),
    } for item in detections]
    return {
        'masks': masks,
        'candidateCount': len(candidates),
        'detectionCount': len(detections),
        'detections': compact_detections,
    }
