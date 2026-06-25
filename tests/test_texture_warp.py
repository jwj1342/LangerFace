from __future__ import annotations

import numpy as np

from langerface.lines.mapping import MappedLine
from langerface.texture import (
    HessianWrinkleExtractor,
    TextureWarpConfig,
    WrinkleField,
    WrinkleFieldConfig,
    warp_mapped_lines,
)


def test_hessian_extractor_detects_horizontal_wrinkle_tangent():
    frame = np.full((48, 64, 3), 220, dtype=np.uint8)
    frame[23:26, 8:56] = 35

    field = HessianWrinkleExtractor(
        WrinkleFieldConfig(gaussian_sigma=1.0, min_strength=0.0, use_clahe=False)
    ).extract(frame)
    direction, strength = field.sample(np.array([[32.0, 24.0]], dtype=np.float64))

    assert strength[0] > 0.2
    assert abs(direction[0, 0]) > 0.9
    assert abs(direction[0, 1]) < 0.35


def test_texture_warp_nudges_prior_line_toward_parallel_wrinkle():
    h, w = 32, 48
    direction = np.zeros((h, w, 2), dtype=np.float32)
    direction[:, :, 0] = 1.0
    strength = np.zeros((h, w), dtype=np.float32)
    strength[14, :] = 1.0
    field = WrinkleField(direction, strength, WrinkleFieldConfig(min_strength=0.0))

    pts = np.column_stack(
        [
            np.linspace(8.0, 40.0, 9),
            np.full(9, 10.0),
            np.zeros(9),
        ]
    )
    line = MappedLine("prior", "test", pts=pts, tris=np.zeros(9, dtype=np.int64))

    warped = warp_mapped_lines(
        [line],
        field,
        TextureWarpConfig(
            enabled=True,
            max_shift_px=6.0,
            search_radius_px=6.0,
            sample_step_px=1.0,
            min_strength=0.1,
            min_orientation_alignment=0.8,
            smoothing_window=1,
        ),
    )[0]

    assert np.mean(warped.pts[:, 1]) > np.mean(line.pts[:, 1]) + 2.5
    assert np.max(np.abs(warped.pts[:, 0] - line.pts[:, 0])) < 1e-9


def test_texture_warp_disabled_preserves_object_identity():
    field = WrinkleField(
        np.dstack([np.ones((4, 4)), np.zeros((4, 4))]).astype(np.float32),
        np.ones((4, 4), dtype=np.float32),
        WrinkleFieldConfig(),
    )
    line = MappedLine("prior", "test", pts=np.zeros((2, 3)), tris=np.zeros(2, dtype=np.int64))

    assert warp_mapped_lines([line], field, TextureWarpConfig(enabled=False))[0] is line
