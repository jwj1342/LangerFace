/** Local image-supported lesion refinement. The scan is coverage, not an
 * object label. Candidate generation never consumes a reference contour.
 * Neutral illumination is separated with log colour ratios; weak shape
 * completion is allowed only after independent inside/outside evidence. */
import type { CV } from '@techstark/opencv-js';
type Point = {
    x: number;
    y: number;
};
type Image = {
    width: number;
    height: number;
    data: ArrayLike<number>;
};
type Vec = [
    number,
    number,
    number
];
type Sample = {
    u: number;
    v: number;
    c: Vec;
};
type Field = {
    coef: number[][];
    noise: Vec;
    inverse: number[][];
    backgroundPixels: number;
};
type Ellipse = {
    boundary: Point[];
    center: Point;
    major: number;
    ratio: number;
    angle: number;
    score: number;
    rankScore?: number;
    anchor: Point;
    context: number;
};
const linear = Float64Array.from({ length: 256 }, (_, i) => i / 255 <= .04045 ? i / 255 / 12.92 : ((i / 255 + .055) / 1.055) ** 2.4);
const pivot = (v: number) => v > (6 / 29) ** 3 ? Math.cbrt(v) : v / (3 * (6 / 29) ** 2) + 4 / 29;
function lab(r: number, g: number, b: number): Vec {
    r = linear[r];
    g = linear[g];
    b = linear[b];
    const x = pivot((.4124564 * r + .3575761 * g + .1804375 * b) / .95047);
    const y = pivot(.2126729 * r + .7151522 * g + .072175 * b);
    const z = pivot((.0193339 * r + .119192 * g + .9503041 * b) / 1.08883);
    return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
const norm = (v: readonly number[]) => Math.hypot(...v);
const clip = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
function quantile(values: number[], p = .5): number {
    const a = values.some(v => !Number.isFinite(v) || Object.is(v, -0))
        ? values.slice().sort((a, b) => a - b) : Float64Array.from(values).sort();
    if (!a.length)
        return 0;
    const x = (a.length - 1) * p;
    const i = Math.floor(x);
    return a[i] + (a[Math.min(i + 1, a.length - 1)] - a[i]) * (x - i);
}
function inverse(a: number[][]): number[][] | null {
    const [x, y, z] = a;
    const det = x[0] * (y[1] * z[2] - y[2] * z[1]) - x[1] * (y[0] * z[2] - y[2] * z[0]) + x[2] * (y[0] * z[1] - y[1] * z[0]);
    if (!Number.isFinite(det) || Math.abs(det) < 1e-10)
        return null;
    return [[y[1] * z[2] - y[2] * z[1], x[2] * z[1] - x[1] * z[2], x[1] * y[2] - x[2] * y[1]],
        [y[2] * z[0] - y[0] * z[2], x[0] * z[2] - x[2] * z[0], x[2] * y[0] - x[0] * y[2]],
        [y[0] * z[1] - y[1] * z[0], x[1] * z[0] - x[0] * z[1], x[0] * y[1] - x[1] * y[0]]].map(r => r.map(v => v / det));
}
function mul(a: number[][], b: number[][]): number[][] {
    return a.map(r => b[0].map((_, j) => r.reduce((s, v, k) => s + v * b[k][j], 0)));
}
function residual(field: Pick<Field, 'coef'>, p: Sample): Vec {
    return p.c.map((v, k) => v - field.coef[0][k] - p.u * field.coef[1][k] - p.v * field.coef[2][k]) as Vec;
}
function fit(points: Sample[], iterations: number): Field | null {
    if (points.length < 40)
        return null;
    let keep = points.map((_, i) => i), coef: number[][] = [], res: Vec[] = [], noise: Vec = [2, 1, 1];
    for (let iteration = 0; iteration < iterations; iteration++) {
        const gram = Array.from({ length: 3 }, () => [0, 0, 0]);
        const rhs = Array.from({ length: 3 }, () => [0, 0, 0]);
        for (const i of keep) {
            const p = points[i], d = [1, p.u, p.v];
            for (let j = 0; j < 3; j++)
                for (let k = 0; k < 3; k++) {
                    gram[j][k] += d[j] * d[k];
                    rhs[j][k] += d[j] * p.c[k];
                }
        }
        const inv = inverse(gram);
        if (!inv)
            return null;
        coef = mul(inv, rhs);
        res = points.map(p => residual({ coef }, p));
        noise = [0, 1, 2].map(k => { const m = quantile(keep.map(i => res[i][k])); return Math.max(k === 0 ? 2 : 1, 1.4826 * quantile(keep.map(i => Math.abs(res[i][k] - m)))); }) as Vec;
        const distances = res.map(v => norm(v.map((x, k) => x / noise[k])));
        const threshold = quantile(distances, .75);
        keep = distances.map((v, i) => v <= threshold ? i : -1).filter(i => i >= 0);
        if (keep.length < 20)
            return null;
    }
    const mean = [0, 1, 2].map(k => keep.reduce((s, i) => s + res[i][k], 0) / keep.length);
    const cov = Array.from({ length: 3 }, (_, j) => [0, 1, 2].map(k => keep.reduce((s, i) => s + (res[i][j] - mean[j]) * (res[i][k] - mean[k]), 0) / Math.max(1, keep.length - 1) + (j === k ? (j === 0 ? 4 : 1) : 0)));
    const inv = inverse(cov);
    return inv ? { coef, noise, inverse: inv, backgroundPixels: keep.length } : null;
}
function distance(v: Vec, field: Field): number {
    return Math.sqrt(Math.max(0, v.reduce((s, x, j) => s + x * field.inverse[j].reduce((t, y, k) => t + y * v[k], 0), 0)));
}
class Patch {
    x0: number;
    y0: number;
    width: number;
    height: number;
    values: Float64Array;
    labValues: Float64Array;
    materialValues: Float64Array;
    anchors: Point[] = [];
    constructor(cv: CV, image: Image, seed: Point, radius: number, materialMode = true) {
        this.x0 = Math.max(0, Math.floor(seed.x - radius - 196));
        this.y0 = Math.max(0, Math.floor(seed.y - radius - 196));
        this.width = Math.min(image.width, Math.ceil(seed.x + radius + 196) + 1) - this.x0;
        this.height = Math.min(image.height, Math.ceil(seed.y + radius + 196) + 1) - this.y0;
        this.values = new Float64Array(this.width * this.height * 3);
        this.labValues = this.values;
        const material = new Float64Array(this.values.length);
        this.materialValues = material;
        const gx0 = Math.ceil(this.x0 / 4) * 4, gy0 = Math.ceil(this.y0 / 4) * 4;
        const gw = Math.ceil((this.x0 + this.width - gx0) / 4), gh = Math.ceil((this.y0 + this.height - gy0) / 4);
        const scores = new Float64Array(gw * gh);
        const src = new cv.Mat(this.height, this.width, cv.CV_8UC3);
        try {
            const out = new cv.Mat();
            try {
                for (let y = 0; y < this.height; y++)
                    for (let x = 0; x < this.width; x++) {
                        const from = ((y + this.y0) * image.width + x + this.x0) * 4, to = (y * this.width + x) * 3;
                        for (let k = 0; k < 3; k++)
                            src.data[to + k] = image.data[from + k];
                    }
                for (const sigma of [2, 10, 18, 30]) {
                    cv.GaussianBlur(src, out, new cv.Size(0, 0), sigma, sigma, cv.BORDER_REFLECT_101);
                    if (sigma === 2) {
                        for (let i = 0; i < this.width * this.height; i++) {
                            const value = lab(out.data[3 * i], out.data[3 * i + 1], out.data[3 * i + 2]);
                            this.values.set(value, 3 * i);
                            material[3 * i + 1] = 100 * Math.log((out.data[3 * i] + 1) / (out.data[3 * i + 1] + 1));
                            material[3 * i + 2] = 100 * Math.log((out.data[3 * i + 2] + 1) / (out.data[3 * i + 1] + 1));
                        }
                    }
                    else {
                        for (let gy = 0; gy < gh; gy++)
                            for (let gx = 0; gx < gw; gx++) {
                                const x = gx0 + 4 * gx, y = gy0 + 4 * gy;
                                if (Math.hypot(x - seed.x, y - seed.y) > radius + 12)
                                    continue;
                                const i = ((y - this.y0) * this.width + x - this.x0) * 3;
                                const other = lab(out.data[i], out.data[i + 1], out.data[i + 2]);
                                const value = norm(other.map((v, k) => (this.values[i + k] - v) / (k === 0 ? 2 : 1.5)));
                                scores[gy * gw + gx] = Math.max(scores[gy * gw + gx], value);
                            }
                    }
                }
                const peaks: {
                    x: number;
                    y: number;
                    value: number;
                }[] = [];
                for (let gy = 1; gy < gh - 1; gy++)
                    for (let gx = 1; gx < gw - 1; gx++) {
                        const x = gx0 + 4 * gx, y = gy0 + 4 * gy, value = scores[gy * gw + gx];
                        if (value < 2 || Math.hypot(x - seed.x, y - seed.y) > .95 * radius)
                            continue;
                        let peak = true;
                        for (let dy = -1; dy <= 1; dy++)
                            for (let dx = -1; dx <= 1; dx++)
                                if (scores[(gy + dy) * gw + gx + dx] > value)
                                    peak = false;
                        if (peak)
                            peaks.push({ x, y, value });
                    }
                peaks.sort((a, b) => b.value - a.value || a.y - b.y || a.x - b.x);
                this.anchors = peaks.map(p => ({ x: p.x, y: p.y }));
            }
            finally {
                out.delete();
            }
        }
        finally {
            src.delete();
        }
        if (materialMode)
            this.values = material;
    }
    materialView(): Patch {
        // Reuse the same preprocessed pixels for material and Lab passes.
        return Object.assign(Object.create(Patch.prototype), this, { values: this.materialValues });
    }
    color(x: number, y: number): Vec {
        const i = ((y - this.y0) * this.width + x - this.x0) * 3;
        return [this.values[i], this.values[i + 1], this.values[i + 2]];
    }
    samples(image: Image, center: Point, major: number, ratio: number, angle: number, low: number, high: number, step: number): Sample[] {
        const reach = major * high + 1, ct = Math.cos(angle), st = Math.sin(angle), result: Sample[] = [];
        for (let y = Math.max(0, Math.floor(center.y - reach)); y <= Math.min(image.height - 1, Math.ceil(center.y + reach)); y += step)
            for (let x = Math.max(0, Math.floor(center.x - reach)); x <= Math.min(image.width - 1, Math.ceil(center.x + reach)); x += step) {
                const dx = x - center.x, dy = y - center.y, u = (ct * dx + st * dy) / major, v = (-st * dx + ct * dy) / (major * ratio), r = Math.hypot(u, v);
                if (r >= low && r <= high)
                    result.push({ u, v, c: this.color(x, y) });
            }
        return result;
    }
}
function outline(center: Point, major: number, ratio: number, angle: number): Point[] {
    const ct = Math.cos(angle), st = Math.sin(angle);
    return Array.from({ length: 96 }, (_, i) => { const t = i * 2 * Math.PI / 96, u = major * Math.cos(t), v = major * ratio * Math.sin(t); return { x: center.x + ct * u - st * v, y: center.y + st * u + ct * v }; });
}
// Cache image-independent radial bins; cap memory for long-running sessions.
const ellipseBinCache = new Map<string, Uint8Array>();
let ellipseBinCacheBytes = 0;
function ellipse(patch: Patch, image: Image, anchor: Point, context: number, materialMode = true): Ellipse | null {
    const field = fit(patch.samples(image, anchor, context, 1, 0, .65, .95, materialMode ? 3 : 2), materialMode ? 4 : 5);
    if (!field)
        return null;
    const points: {
        x: number;
        y: number;
        value: number;
    }[] = [];
    const x0 = Math.max(0, Math.floor(anchor.x - context)), y0 = Math.max(0, Math.floor(anchor.y - context));
    for (let y = y0; y <= Math.min(image.height - 1, Math.ceil(anchor.y + context)); y += 3)
        for (let x = x0; x <= Math.min(image.width - 1, Math.ceil(anchor.x + context)); x += 3) {
            const p = { u: (x - anchor.x) / context, v: (y - anchor.y) / context, c: patch.color(x, y) };
            points.push({ x: p.u, y: p.v, value: clip(distance(residual(field, p), field) - 2, -2, 4) });
        }
    let best: Ellipse | null = null;
    const key = [context, x0 - anchor.x, y0 - anchor.y,
        Math.min(image.width - 1, Math.ceil(anchor.x + context)) - x0,
        Math.min(image.height - 1, Math.ceil(anchor.y + context)) - y0].join(':');
    let bins = ellipseBinCache.get(key);
    const fresh = !bins;
    if (!bins && points.length * 450 <= 8 * 1024 * 1024) {
        const bytes = points.length * 450;
        while (ellipseBinCacheBytes + bytes > 8 * 1024 * 1024) {
            const oldest = ellipseBinCache.keys().next().value;
            if (oldest === undefined) break;
            const old = ellipseBinCache.get(oldest);
            if (!old) break;
            ellipseBinCacheBytes -= old.byteLength;
            ellipseBinCache.delete(oldest);
        }
        bins = new Uint8Array(bytes);
    }
    let combination = 0;
    for (const oy of [-.4, -.2, 0, .2, .4])
        for (const ox of [-.4, -.2, 0, .2, .4])
            for (const degrees of [0, 30, 60, 90, 120, 150])
                for (const ratio of [.5, .7, 1]) {
                    const angle = degrees * Math.PI / 180, ct = Math.cos(angle), st = Math.sin(angle);
                    const sums = new Float64Array(9), counts = new Int32Array(9);
                    let binIndex = combination++ * points.length;
                    for (const p of points) {
                        const dx = p.x - ox, dy = p.y - oy, u = ct * dx + st * dy, v = (-st * dx + ct * dy) / ratio;
                        let index: number;
                        if (bins && !fresh) index = bins[binIndex];
                        else {
                            index = Math.max(0, Math.ceil((Math.hypot(u, v) - .12) / .06 - 1e-10));
                            if (bins) bins[binIndex] = Math.min(9, index);
                        }
                        binIndex++;
                        if (index < 9) {
                            sums[index] += p.value;
                            counts[index]++;
                        }
                    }
                    let sum = 0, count = 0;
                    for (let index = 0; index < 9; index++) {
                        sum += sums[index];
                        count += counts[index];
                        if (count < 8)
                            continue;
                        const major = (.12 + .06 * index) * context, center = { x: anchor.x + ox * context, y: anchor.y + oy * context };
                        const score = sum / Math.sqrt(count);
                        if (score <= 0 || best && score <= best.score)
                            continue;
                        const boundary = outline(center, major, ratio, angle);
                        if (boundary.some(p => Math.hypot(p.x - anchor.x, p.y - anchor.y) > .94 * context))
                            continue;
                        best = { boundary, center, major, ratio, angle, score, anchor, context };
                    }
                }
    if (bins && fresh) {
        ellipseBinCache.set(key, bins);
        ellipseBinCacheBytes += bins.byteLength;
    }
    return best;
}
function rank(patch: Patch, image: Image, c: Ellipse): number {
    const field = fit(patch.samples(image, c.center, c.major, c.ratio, c.angle, 1.15, 1.65, 2), 4);
    if (!field)
        return -Infinity;
    const inside = patch.samples(image, c.center, c.major, c.ratio, c.angle, 0, 1, 1);
    return inside.reduce((sum, p) => sum + clip(distance(residual(field, p), field) - 2, -2, 4), 0) / Math.sqrt(Math.max(1, inside.length));
}
function polygonArea(b: Point[]): number {
    return Math.abs(b.reduce((s, p, i) => { const q = b[(i + 1) % b.length]; return s + p.x * q.y - q.x * p.y; }, 0) / 2);
}
function polygonCentroid(b: Point[]): Point {
    let twiceArea = 0, x = 0, y = 0;
    for (let i = 0; i < b.length; i++) {
        const p = b[i], q = b[(i + 1) % b.length], cross = p.x * q.y - q.x * p.y;
        twiceArea += cross;
        x += (p.x + q.x) * cross;
        y += (p.y + q.y) * cross;
    }
    return Math.abs(twiceArea) > 1e-8 ? { x: x / (3 * twiceArea), y: y / (3 * twiceArea) }
        : { x: b.reduce((s, p) => s + p.x, 0) / b.length, y: b.reduce((s, p) => s + p.y, 0) / b.length };
}
// All body proposals are convex hulls or ellipses. Area intersection avoids
// counting boundary vertices, whose density and on-edge convention vary.
function convexIntersectionArea(subject: Point[], clipBoundary: Point[]): number {
    const orientation = clipBoundary.reduce((s, p, i) => { const q = clipBoundary[(i + 1) % clipBoundary.length]; return s + p.x * q.y - q.x * p.y; }, 0) >= 0 ? 1 : -1;
    let points = subject.slice();
    for (let i = 0; i < clipBoundary.length && points.length; i++) {
        const a = clipBoundary[i], b = clipBoundary[(i + 1) % clipBoundary.length];
        const side = (p: Point) => orientation * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
        const output: Point[] = [];
        let previous = points[points.length - 1], ps = side(previous);
        for (const p of points) {
            const s = side(p);
            if ((s >= 0) !== (ps >= 0)) {
                const t = ps / (ps - s);
                output.push({ x: previous.x + t * (p.x - previous.x), y: previous.y + t * (p.y - previous.y) });
            }
            if (s >= 0)
                output.push(p);
            previous = p;
            ps = s;
        }
        points = output;
    }
    return points.length >= 3 ? polygonArea(points) : 0;
}
function contains(p: Point, b: Point[]): boolean {
    let yes = false;
    for (let i = 0, j = b.length - 1; i < b.length; j = i++) {
        const a = b[i], c = b[j];
        if ((a.y > p.y) !== (c.y > p.y) && p.x < (c.x - a.x) * (p.y - a.y) / (c.y - a.y) + a.x)
            yes = !yes;
    }
    return yes;
}
function segmentDistance(p: Point, a: Point, b: Point): number {
    const dx = b.x - a.x, dy = b.y - a.y, t = clip(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
    return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
function signedArea(boundary: Point[]): number {
    return boundary.reduce((sum, point, index) => {
        const next = boundary[(index + 1) % boundary.length];
        return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2;
}
function resampleClosedBoundary(boundary: Point[], count = 96): Point[] {
    if (boundary.length < 3 || count < 8)
        return boundary.slice();
    const lengths = boundary.map((point, index) => {
        const next = boundary[(index + 1) % boundary.length];
        return Math.hypot(next.x - point.x, next.y - point.y);
    });
    const perimeter = lengths.reduce((sum, length) => sum + length, 0);
    if (!(perimeter > 1e-6))
        return boundary.slice();
    const result: Point[] = [];
    let segment = 0, segmentStart = 0;
    for (let index = 0; index < count; index += 1) {
        const target = perimeter * index / count;
        while (segment < lengths.length - 1 && segmentStart + lengths[segment] < target) {
            segmentStart += lengths[segment];
            segment += 1;
        }
        const start = boundary[segment], end = boundary[(segment + 1) % boundary.length];
        const ratio = lengths[segment] > 1e-9
            ? (target - segmentStart) / lengths[segment] : 0;
        result.push({
            x: start.x + (end.x - start.x) * ratio,
            y: start.y + (end.y - start.y) * ratio,
        });
    }
    return result;
}
function boundaryDistance(point: Point, boundary: Point[]): number {
    let best = Infinity;
    for (let index = 0; index < boundary.length; index += 1)
        best = Math.min(best, segmentDistance(point, boundary[index], boundary[(index + 1) % boundary.length]));
    return best;
}
function boundarySelfIntersects(boundary: Point[]): boolean {
    const turn = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const intersects = (a: Point, b: Point, c: Point, d: Point) => {
        const ab = turn(a, b, c) * turn(a, b, d);
        const cd = turn(c, d, a) * turn(c, d, b);
        return ab < -1e-8 && cd < -1e-8;
    };
    for (let i = 0; i < boundary.length; i += 1)
        for (let j = i + 2; j < boundary.length; j += 1) {
            if (i === 0 && j === boundary.length - 1)
                continue;
            if (intersects(boundary[i], boundary[(i + 1) % boundary.length],
                boundary[j], boundary[(j + 1) % boundary.length]))
                return true;
        }
    return false;
}
/**
 * 填补小而窄的内凹，保留大尺度的不规则轮廓。
 * 这是最终候选的几何整理，不参与候选选择，也不能补出没有颜色证据的缺失区域。
 */
function regularizeAppearanceBoundary(boundary: Point[]): {
    boundary: Point[];
    repairedPoints: number;
    areaRatio: number;
    maxDisplacement: number;
} {
    if (boundary.length < 12)
        return { boundary, repairedPoints: 0, areaRatio: 1, maxDisplacement: 0 };
    const original = boundary.slice();
    const originalArea = polygonArea(original);
    const sampled = resampleClosedBoundary(original);
    const orientation = signedArea(sampled) >= 0 ? 1 : -1;
    let current = sampled;
    let repairedPoints = 0;
    for (let pass = 0; pass < 2; pass += 1) {
        const next = current.map(point => ({ ...point }));
        for (let index = 0; index < current.length; index += 1) {
            const window = 6;
            const previous = current[(index - window + current.length) % current.length];
            const following = current[(index + window) % current.length];
            const turn = ((current[index].x - previous.x) * (following.y - current[index].y)
                - (current[index].y - previous.y) * (following.x - current[index].x)) * orientation;
            if (turn >= -0.8)
                continue;
            const dx = following.x - previous.x, dy = following.y - previous.y;
            const ratio = clip(((current[index].x - previous.x) * dx
                + (current[index].y - previous.y) * dy) / (dx * dx + dy * dy || 1), 0, 1);
            const projection = { x: previous.x + dx * ratio, y: previous.y + dy * ratio };
            const depth = Math.hypot(current[index].x - projection.x, current[index].y - projection.y);
            if (depth < 0.35 || depth > 2.75)
                continue;
            const step = Math.min(0.9, depth * 0.68);
            next[index] = {
                x: current[index].x + (projection.x - current[index].x) * step / depth,
                y: current[index].y + (projection.y - current[index].y) * step / depth,
            };
            repairedPoints += 1;
        }
        current = next;
    }
    if (!repairedPoints)
        return { boundary, repairedPoints: 0, areaRatio: 1, maxDisplacement: 0 };
    current = current.map((point, index, source) => {
        const previous = source[(index - 1 + source.length) % source.length];
        const next = source[(index + 1) % source.length];
        return {
            x: point.x * 0.82 + (previous.x + next.x) * 0.09,
            y: point.y * 0.82 + (previous.y + next.y) * 0.09,
        };
    });
    const area = polygonArea(current);
    const areaRatio = area / Math.max(1, originalArea);
    const maxDisplacement = Math.max(
        ...current.map(point => boundaryDistance(point, original)),
        ...sampled.map(point => boundaryDistance(point, current)),
    );
    if (areaRatio < 0.98 || areaRatio > 1.08 || maxDisplacement > 2
        || boundarySelfIntersects(current)
        || !Number.isFinite(areaRatio) || !Number.isFinite(maxDisplacement))
        return { boundary, repairedPoints: 0, areaRatio: 1, maxDisplacement: 0 };
    return { boundary: current, repairedPoints, areaRatio, maxDisplacement };
}
function hull(points: Point[]): Point[] {
    const p = points.slice().sort((a, b) => a.x - b.x || a.y - b.y);
    const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const low: Point[] = [], high: Point[] = [];
    for (const q of p) {
        while (low.length > 1 && cross(low[low.length - 2], low[low.length - 1], q) <= 0)
            low.pop();
        low.push(q);
    }
    for (const q of p.slice().reverse()) {
        while (high.length > 1 && cross(high[high.length - 2], high[high.length - 1], q) <= 0)
            high.pop();
        high.push(q);
    }
    return [...low.slice(0, -1), ...high.slice(0, -1)];
}
// Exact one-dimensional quadratic distance transform, with predecessor indices.
// It keeps the closed-contour search linear in the number of radial states.
function transition(previous: Float64Array): {
    value: Float64Array;
    index: Int32Array;
} {
    const n = previous.length, v = new Int32Array(n), z = new Float64Array(n + 1);
    let k = -1;
    for (let q = 0; q < n; q++) {
        if (!Number.isFinite(previous[q]))
            continue;
        let s = -Infinity;
        while (k >= 0) {
            const p = v[k];
            s = ((-previous[q] + .4 * q * q) - (-previous[p] + .4 * p * p)) / (.8 * (q - p));
            if (s > z[k])
                break;
            k--;
        }
        k++;
        v[k] = q;
        z[k] = k === 0 ? -Infinity : s;
        z[k + 1] = Infinity;
    }
    const value = new Float64Array(n), index = new Int32Array(n);
    let cursor = 0;
    for (let q = 0; q < n; q++) {
        while (cursor < k && z[cursor + 1] < q)
            cursor++;
        const p = v[cursor];
        index[q] = p;
        value[q] = previous[p] - .4 * (q - p) ** 2;
    }
    return { value, index };
}
function star(patch: Patch, image: Image, c: Ellipse, mixedLight = false): {
    boundary: Point[];
    atMaximum: number;
} | null {
    const field = fit(patch.samples(image, c.center, c.major, c.ratio, c.angle, 1.4, 2.2, 1), 4);
    if (!field)
        return null;
    const core = patch.samples(image, c.center, c.major, c.ratio, c.angle, 0, .6, 1);
    if (core.length < 20)
        return null;
    const delta = [0, 1, 2].map(k => quantile(core.map(p => residual(field, p)[k])) / field.noise[k]);
    const magnitude = norm(delta);
    if (magnitude < 1e-8)
        return null;
    const direction = delta.map(v => v / magnitude);
    const n = Math.floor(c.major * 1.7) - 3;
    if (n < 3)
        return null;
    const unary: Float64Array[] = [], radii = Float64Array.from({ length: n }, (_, i) => i + 4);
    for (let a = 0; a < 64; a++) {
        const theta = a * Math.PI / 32, cs = Math.cos(theta), sn = Math.sin(theta);
        const ellipseRadius = c.major / Math.hypot(Math.cos(theta - c.angle), Math.sin(theta - c.angle) / c.ratio);
        const values = new Float64Array(n);
        let cumulative = 0;
        for (let i = 0; i < n; i++) {
            const r = radii[i], x = Math.round(c.center.x + cs * r), y = Math.round(c.center.y + sn * r);
            let local = -100;
            if (x >= 0 && y >= 0 && x < image.width && y < image.height) {
                const dx = x - c.center.x, dy = y - c.center.y;
                const p = { u: (Math.cos(c.angle) * dx + Math.sin(c.angle) * dy) / c.major,
                    v: (-Math.sin(c.angle) * dx + Math.cos(c.angle) * dy) / (c.major * c.ratio), c: patch.color(x, y) };
                const rr = residual(field, p), projection = mixedLight ? distance(rr, field)
                    : rr.reduce((s, v, k) => s + v / field.noise[k] * direction[k], 0);
                local = clip(projection - 1.5, -2, 4) * r / c.major;
            }
            cumulative += local;
            values[i] = cumulative - .02 * (r - ellipseRadius) ** 2;
        }
        unary.push(values);
    }
    let bestScore = -Infinity, best: number[] = [];
    for (let first = 0; first < n; first += 3) {
        let values: Float64Array = new Float64Array(n).fill(-Infinity);
        values[first] = unary[0][first];
        const back: Int32Array[] = [];
        for (let a = 1; a < 64; a++) {
            const t = transition(values);
            back.push(t.index);
            values = t.value;
            for (let i = 0; i < n; i++)
                values[i] += unary[a][i];
        }
        let last = 0, score = -Infinity;
        for (let i = 0; i < n; i++) {
            const s = values[i] - .4 * (i - first) ** 2;
            if (s > score) {
                score = s;
                last = i;
            }
        }
        if (score <= bestScore)
            continue;
        bestScore = score;
        const selected = [last];
        for (let a = 62; a >= 0; a--) {
            last = back[a][last];
            selected.push(last);
        }
        best = selected.reverse();
    }
    if (!best.length)
        return null;
    return { boundary: best.map((r, a) => ({ x: c.center.x + Math.cos(a * Math.PI / 32) * radii[r], y: c.center.y + Math.sin(a * Math.PI / 32) * radii[r] })),
        atMaximum: best.filter(r => r === n - 1).length / 64 };
}
function complete(starBoundary: Point[]): Point[] | null {
    const b = hull(starBoundary), area = polygonArea(b);
    if (area < 20 || area / Math.max(1, polygonArea(starBoundary)) > 1.5)
        return null;
    const xs = b.map(p => p.x), ys = b.map(p => p.y), pixels: Point[] = [];
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++)
        for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++)
            if (contains({ x: x + .5, y: y + .5 }, b))
                pixels.push({ x: x + .5, y: y + .5 });
    if (pixels.length < 20)
        return null;
    const center = { x: pixels.reduce((s, p) => s + p.x, 0) / pixels.length, y: pixels.reduce((s, p) => s + p.y, 0) / pixels.length };
    const xx = pixels.reduce((s, p) => s + (p.x - center.x) ** 2, 0) / pixels.length;
    const yy = pixels.reduce((s, p) => s + (p.y - center.y) ** 2, 0) / pixels.length;
    const xy = pixels.reduce((s, p) => s + (p.x - center.x) * (p.y - center.y), 0) / pixels.length;
    const difference = Math.hypot(xx - yy, 2 * xy), lo = (xx + yy - difference) / 2, hi = (xx + yy + difference) / 2;
    if (lo <= 0 || hi <= 0)
        return null;
    const ratio = Math.sqrt(lo / hi), diameter = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    if (ratio < .5)
        return diameter >= 60 && ratio >= .35 ? b : null;
    let major = 2 * Math.sqrt(hi), minor = 2 * Math.sqrt(lo);
    const scale = Math.sqrt(area / (Math.PI * major * minor));
    major *= scale;
    minor *= scale;
    const angle = Math.atan2(2 * xy, xx - yy) / 2, ellipseBoundary = outline(center, major, minor / major, angle);
    const displacement = Math.max(...ellipseBoundary.map(p => Math.min(...b.map((q, i) => segmentDistance(p, q, b[(i + 1) % b.length]))))) / Math.sqrt(area / Math.PI);
    return displacement <= .30 ? ellipseBoundary : null;
}
function bodyEvidence(
    patch: Patch,
    image: Image,
    b: Point[],
    compactLab = false,
    mixedLight = false,
    supportedCompact = false,
): Record<string, unknown> | null {
    const xs = b.map(p => p.x), ys = b.map(p => p.y), diameter = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    const localLab = compactLab || mixedLight;
    // The 48px proposal context is not a bounding-box limit. Mixed-light peers
    // may be slightly wider; the full background ring must still fit the patch.
    if (diameter < (localLab ? 24 : 40) || diameter > (mixedLight ? 64 : localLab ? 48 : 160))
        return null;
    const reach = Math.ceil(diameter * .45), x0 = Math.max(0, Math.floor(Math.min(...xs)) - reach), y0 = Math.max(0, Math.floor(Math.min(...ys)) - reach);
    const x1 = Math.min(image.width, Math.ceil(Math.max(...xs)) + reach + 1), y1 = Math.min(image.height, Math.ceil(Math.max(...ys)) + reach + 1);
    const center = { x: xs.reduce((s, x) => s + x, 0) / xs.length, y: ys.reduce((s, y) => s + y, 0) / ys.length };
    const points: {
        x: number;
        y: number;
        inside: boolean;
        distance: number;
        c: Vec;
    }[] = [];
    let count = 0;
    for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
            if (x < patch.x0 || y < patch.y0 || x >= patch.x0 + patch.width || y >= patch.y0 + patch.height)
                return null;
            const p = { x: x + .5, y: y + .5 }, isInside = contains(p, b);
            let d = Infinity;
            for (let i = 0; i < b.length; i++) d = Math.min(d, segmentDistance(p, b[i], b[(i + 1) % b.length]));
            const color = patch.color(x, y);
            color[0] = patch.labValues[((y - patch.y0) * patch.width + x - patch.x0) * 3];
            count += Number(isInside);
            points.push({ ...p, inside: isInside, distance: d, c: color });
        }
    if (count < 400)
        return null;
    const radius = Math.sqrt(count / Math.PI), samples = (test: (p: typeof points[number]) => boolean): Sample[] => points.filter(test).map(p => ({ u: (p.x - center.x) / radius, v: (p.y - center.y) / radius, c: p.c }));
    const core = samples(p => p.inside && p.distance >= .15 * radius);
    const ring = samples(p => !p.inside && p.distance >= .15 * radius && p.distance <= .65 * radius);
    const outer = samples(p => !p.inside && p.distance >= .35 * radius && p.distance <= .85 * radius);
    if (core.length < 40 || ring.length < 80 || outer.length < 80)
        return null;
    const field = fit(ring, 4);
    if (!field)
        return null;
    const residuals = core.map(p => residual(field, p));
    const delta = [0, 1, 2].map(k => quantile(residuals.map(v => v[k]))) as Vec;
    const normalized = delta.slice(1).map((v, k) => v / field.noise[k + 1]), chromaticDistance = norm(normalized);
    if (!mixedLight && (delta[0] > -1.5 || chromaticDistance < 5))
        return null;
    const projection = (v: Vec) => mixedLight ? norm(v.map((x, k) => x / field.noise[k]))
        : v[1] / field.noise[1] * normalized[0] / chromaticDistance + v[2] / field.noise[2] * normalized[1] / chromaticDistance;
    const strength = mixedLight ? quantile(residuals.map(projection)) : chromaticDistance;
    const outerCutoff = mixedLight ? quantile(outer.map(p => projection(residual(field, p))), .9) : 1;
    const support = residuals.filter(v => projection(v) >= (mixedLight ? outerCutoff : Math.max(.75, .4 * strength))).length / core.length;
    const continuation = outer.filter(p => projection(residual(field, p)) >= Math.max(mixedLight ? 2.5 : 1.5, .5 * strength)).length / outer.length;
    const sectors = Array.from({ length: 8 }, () => [] as number[]);
    core.forEach((p, i) => sectors[Math.floor((Math.atan2(p.v, p.u) + Math.PI) * 4 / Math.PI) % 8].push(projection(residuals[i])));
    const medians = sectors.map(v => v.length ? quantile(v) : -Infinity), weak = medians.map(v => v < outerCutoff);
    let longest = 0, current = 0;
    for (const w of [...weak, ...weak]) {
        current = w ? current + 1 : 0;
        longest = Math.max(longest, current);
    }
    if (!mixedLight && (support < .7 || continuation > .2 || weak.filter(v => !v).length < 6 || longest > 2))
        return null;
    const highlightFraction = residuals.filter(v => v[0] >= 4).length / residuals.length;
    const darkFraction = residuals.filter(v => v[0] <= -4).length / residuals.length;
    // 小主体的新路径不能只靠一个暗核扩大：外围颜色证据要更完整，
    // 内部还须同时出现亮、暗区域；均匀小痣和单个高光不走这条路径。
    if (compactLab && (support < .88 || continuation > .06 || weak.some(Boolean)
        || highlightFraction < .02 || darkFraction < .6))
        return null;
    // 无符号颜色距离同时保留亮面和暗面。背景也有纹理，不能把普通
    // 固定阈值的尾部比例当作延伸；用独立外环90%分位校准内部支持。
    if (mixedLight && (strength < 4 || support < .7 || weak.filter(v => !v).length < 7
        || longest > 1 || highlightFraction < (supportedCompact ? .02 : .1) || darkFraction < .35))
        return null;
    return { diameter, area: count, ...(localLab ? { deltaLab: delta, highlightFraction, darkFraction }
        : { deltaLAndLogRatios: delta }), noise: field.noise,
        ...(mixedLight ? { normalizedResidualMedian: strength, backgroundQuantile: .9,
            backgroundCutoff: outerCutoff, calibratedInteriorSupport: support } : { materialDistance: strength }),
        interiorSupport: support, outerContinuation: continuation, sectorMedianProjection: medians };
}
type BodyCandidate = {
    boundary: Point[];
    evidence: Record<string, unknown>;
    score: number;
    scanComplete: boolean;
    incompleteBoundary?: Point[];
};

function associateBodyCandidates(bank: BodyCandidate[], reference?: ControlledMarkerDetection): BodyCandidate[] {
    if (!reference?.ok || reference.geometry_mode !== 'dark_component'
        || reference.boundary.length < 3 || !reference.center)
        return bank;
    const area = polygonArea(reference.boundary);
    if (!(area > 0)) return bank;
    // 扫描范围可以包含多个对象。远处阴影不能覆盖或否定已支持的局部对象；
    // 包含局部碎片的更大主体仍保留，不能绕过原有扫描完整性检查。
    return bank.filter(candidate => contains(reference.center!, candidate.boundary)
        || convexIntersectionArea(reference.boundary, candidate.boundary) / area >= .5);
}

function refineCompactLabBody(cv: CV, image: Image, seed: Point, radius: number,
    reference: ControlledMarkerDetection): ControlledMarkerDetection {
    const route = String(reference.diagnostics?.filled_candidate_route || '');
    if (!reference.ok || reference.geometry_mode !== 'dark_component' || !reference.center
        || reference.boundary.length < 3 || reference.area_px < 64 || reference.area_px > 1600
        || !['localized_pigment_envelope', 'material_body_envelope'].includes(route))
        return reference;
    // 固定局部尺度跟随已有对象，不随操作者扩大扫描圈而扩大前景模型。
    // 全部候选仍须在原扫描圈内；这里不改变原有大主体或笔圈的门槛。
    const patch = new Patch(cv, image, reference.center, 48, false);
    const anchors = patch.anchors.filter(p => Math.hypot(p.x - reference.center!.x,
        p.y - reference.center!.y) <= 28).slice(0, 8);
    const candidates: BodyCandidate[] = [];
    for (const anchor of anchors) {
        const proposal = ellipse(patch, image, anchor, 32, false);
        if (!proposal) continue;
        const radial = star(patch, image, proposal);
        if (!radial || radial.atMaximum > .05) continue;
        const boundary = complete(radial.boundary);
        if (!boundary || boundary.some(p => p.x < 0 || p.y < 0
            || p.x >= image.width || p.y >= image.height
            || Math.hypot(p.x - seed.x, p.y - seed.y) > .95 * radius)) continue;
        const evidence = bodyEvidence(patch, image, boundary, true);
        const ratio = polygonArea(boundary) / reference.area_px;
        if (!evidence || ratio < 1.8 || ratio > 6
            || convexIntersectionArea(reference.boundary, boundary) / reference.area_px < .85)
            continue;
        candidates.push({ boundary, evidence: { ...evidence, anchor, context: 32,
            previousAreaPx: reference.area_px, appearanceSpace: 'Lab' }, scanComplete: true,
            score: Number(evidence.interiorSupport) * (1 - Number(evidence.outerContinuation)) });
    }
    candidates.sort((a, b) => b.score - a.score);
    const selected = candidates[0];
    const compactResult = selected
        ? appearanceResult(reference, selected.boundary, seed, 'compact_mixed_light_body', selected.evidence)
        : reference;
    if (selected && route !== 'material_body_envelope') return compactResult;
    // Unsigned residuals can also include ordinary shading around a dark body.
    // Use this recovery only for the local-pigment fragment path, not an already
    // supported material-body envelope with its own background/expansion checks.
    const supportedCompact = route === 'material_body_envelope' && !!selected;
    if (route !== 'localized_pigment_envelope' && !supportedCompact) return compactResult;
    const mixedPatch = supportedCompact ? new Patch(cv, image, compactResult.center!, 64, false) : patch;
    const mixedAnchors = supportedCompact
        ? mixedPatch.anchors.filter(p => Math.hypot(
            p.x - compactResult.center!.x, p.y - compactResult.center!.y) <= 40).slice(0, 12)
        : anchors;
    const mixed: BodyCandidate[] = [];
    for (const anchor of mixedAnchors) {
        const proposal = ellipse(mixedPatch, image, anchor, 48, false);
        if (!proposal) continue;
        const radial = star(mixedPatch, image, proposal, true);
        if (!radial || radial.atMaximum > .05) continue;
        const boundary = complete(radial.boundary);
        if (!boundary || boundary.some(p => p.x < 0 || p.y < 0
            || p.x >= image.width || p.y >= image.height)) continue;
        const evidence = bodyEvidence(mixedPatch, image, boundary, false, true, supportedCompact);
        const ratio = polygonArea(boundary) / reference.area_px;
        if (!evidence || ratio < 1.8 || ratio > 6
            || convexIntersectionArea(reference.boundary, boundary) / reference.area_px < .85) continue;
        mixed.push({ boundary, evidence: { ...evidence, anchor, context: 48,
            previousAreaPx: reference.area_px, appearanceSpace: 'background-calibrated-Lab-norm' },
            scanComplete: boundary.every(p => Math.hypot(p.x - seed.x, p.y - seed.y) <= .95 * radius),
            score: Number(evidence.calibratedInteriorSupport) });
    }
    const supported = mixed.filter(candidate => mixed.some(peer => {
        if (peer === candidate) return false;
        const a = candidate.evidence.anchor as Point, b = peer.evidence.anchor as Point;
        const intersection = convexIntersectionArea(candidate.boundary, peer.boundary);
        return Math.hypot(a.x - b.x, a.y - b.y) >= 12 && intersection
            / (polygonArea(candidate.boundary) + polygonArea(peer.boundary) - intersection)
            >= (supportedCompact ? .9 : .75);
    })).sort((a, b) => b.score - a.score);
    const whole = supported[0];
    if (!whole) return compactResult;
    if (supportedCompact && (polygonArea(whole.boundary) < 1.15 * compactResult.area_px
        || convexIntersectionArea(compactResult.boundary, whole.boundary) / compactResult.area_px < .85)) {
        return compactResult;
    }
    const rejectedDiagnostics = { ...reference.diagnostics,
        filled_candidate_route: 'rejected_incomplete_mixed_light_body', appearance_evidence: whole.evidence };
    if (!whole.scanComplete) return { ...reference, ok: false, failure_code: 'scan_range_too_small',
        center: null, boundary: [], area_px: 0, bbox: null, geometry_mode: null, seed_relation: null,
        marker_area_px: 0, marker_bbox: null, confidence: 0, rejected_boundary: whole.boundary,
        rejected_geometry_mode: 'dark_component', rejected_reasons: ['appearance_candidate_outside_scan_roi'],
        warnings: [...reference.warnings, 'appearance_candidate_outside_scan_roi'],
        diagnostics: rejectedDiagnostics };
    return appearanceResult(reference, whole.boundary, seed,
        supportedCompact ? 'compact_supported_mixed_light_body' : 'calibrated_mixed_light_body',
        whole.evidence);
}

function selectCompleteBodyCandidate(bank: BodyCandidate[]): BodyCandidate | null {
    const complete = bank.filter(candidate => candidate.scanComplete);
    if (!complete.length) return bank[0] ?? null;

    const top = complete[0];
    // A high-scoring small fragment can beat the repeated full-body proposal.
    // Use convex overlap as a cheap consensus measure, but only switch for a
    // clear local-fragment signal; ordinary score differences retain the
    // established ranking and avoid broadening unrelated targets.
    const consensus = (candidate: BodyCandidate) => complete.reduce((sum, other) => {
        const intersection = convexIntersectionArea(candidate.boundary, other.boundary);
        const union = polygonArea(candidate.boundary) + polygonArea(other.boundary) - intersection;
        return sum + intersection / Math.max(1, union);
    }, 0);
    const topConsensus = consensus(top);
    const medoid = complete.reduce((best, candidate) => {
        const candidateConsensus = consensus(candidate), bestConsensus = consensus(best);
        return candidateConsensus > bestConsensus
            || candidateConsensus === bestConsensus && candidate.score > best.score ? candidate : best;
    }, top);
    const medoidConsensus = consensus(medoid);
    const topAnchor = top.evidence.anchor as Point | undefined;
    const medoidAnchor = medoid.evidence.anchor as Point | undefined;
    const anchorDistance = (a: BodyCandidate, b: BodyCandidate) => {
        const aa = a.evidence.anchor as Point | undefined, bb = b.evidence.anchor as Point | undefined;
        return aa && bb ? Math.hypot(aa.x - bb.x, aa.y - bb.y) : 0;
    };
    const distinctAnchorPeer = complete.some(candidate => candidate !== medoid
        && anchorDistance(candidate, medoid) >= 12
        && convexIntersectionArea(candidate.boundary, medoid.boundary)
        / Math.max(1, polygonArea(candidate.boundary) + polygonArea(medoid.boundary)
            - convexIntersectionArea(candidate.boundary, medoid.boundary)) >= .9);
    const topIsFragment = polygonArea(top.boundary) / Math.max(1, polygonArea(medoid.boundary)) <= .8;
    const medoidHasClearerConsensus = polygonArea(top.boundary) / Math.max(1, polygonArea(medoid.boundary)) <= .95
        && medoidConsensus - topConsensus >= .5;
    const sameAnchorFragmentWithPeer = topAnchor && medoidAnchor
        && Math.hypot(topAnchor.x - medoidAnchor.x, topAnchor.y - medoidAnchor.y) < 12
        && topIsFragment && distinctAnchorPeer;
    return medoid !== top
        && (topIsFragment && (distinctAnchorPeer || sameAnchorFragmentWithPeer) || medoidHasClearerConsensus)
        ? medoid : top;
}

function materialWholeBodyCandidate(cv: CV, image: Image, seed: Point, radius: number, reference?: ControlledMarkerDetection, prepared?: Patch): BodyCandidate | null {
    if (!Number.isFinite(radius) || radius < 12 || radius > 400 || image.data.length !== image.width * image.height * 4)
        return null;
    const patch = prepared ?? new Patch(cv, image, seed, radius), anchors: Point[] = [], bank: BodyCandidate[] = [];
    for (const pool of [patch.anchors, patch.anchors.slice().sort((a, b) => Math.hypot(a.x - seed.x, a.y - seed.y) - Math.hypot(b.x - seed.x, b.y - seed.y))]) {
        const limit = anchors.length < 4 ? 4 : 8;
        for (const a of pool) {
            if (anchors.some(p => Math.hypot(a.x - p.x, a.y - p.y) < 24))
                continue;
            anchors.push(a);
            if (anchors.length >= limit)
                break;
        }
    }
    for (const anchor of anchors)
        for (const context of [64, 96]) {
            const c = ellipse(patch, image, anchor, context);
            if (!c || c.boundary.some(p => p.x < 0 || p.y < 0 || p.x >= image.width || p.y >= image.height))
                continue;
            const s = star(patch, image, c);
            if (!s || s.atMaximum > .05)
                continue;
            const b = complete(s.boundary);
            if (!b || b.some(p => p.x < 0 || p.y < 0 || p.x >= image.width || p.y >= image.height))
                continue;
            const evidence = bodyEvidence(patch, image, b);
            if (!evidence)
                continue;
            const score = Math.min(8, Number(evidence.materialDistance)) * Math.sqrt(Number(evidence.area)) * Number(evidence.interiorSupport) * (1 - Number(evidence.outerContinuation));
            bank.push({ boundary: b, evidence: { ...evidence, anchor, context }, score, scanComplete: b.every(p => Math.hypot(p.x - seed.x, p.y - seed.y) <= .95 * radius) });
        }
    const associated = associateBodyCandidates(bank, reference).sort((a, b) => b.score - a.score);
    const selected = selectCompleteBodyCandidate(associated);
    if (!selected)
        return null;
    const center = polygonCentroid(selected.boundary);
    const selectedArea = polygonArea(selected.boundary);
    // An unrelated shadow outside the scan cannot veto a complete lesion.
    // Reject a smaller inside fragment only when the supported larger outside
    // body contains it, shares its centre and is substantially larger.
    const clipped = associated.find(c => {
        if (c.scanComplete || polygonArea(c.boundary) < 1.5 * selectedArea)
            return false;
        const cc = polygonCentroid(c.boundary);
        return Math.hypot(cc.x - center.x, cc.y - center.y) <= .4 * Math.sqrt(polygonArea(c.boundary) / Math.PI)
            && convexIntersectionArea(selected.boundary, c.boundary) / selectedArea >= .9;
    });
    return clipped ? { ...selected, scanComplete: false, incompleteBoundary: clipped.boundary } : selected;
}
function localizedPigmentCandidate(cv: CV, image: Image, seed: Point, radius: number, prepared?: Patch): {
    candidate: Ellipse;
    evidence: Record<string, unknown>;
} | null {
    if (!Number.isFinite(radius) || radius < 12 || radius > 400 || image.data.length !== image.width * image.height * 4)
        return null;
    const patch = prepared ?? new Patch(cv, image, seed, radius, false);
    const anchors = pigmentAnchors(patch.anchors, seed);
    let best: {
        candidate: Ellipse;
        evidence: Record<string, unknown>;
    } | null = null;
    // Validate every bounded proposal before ranking. A larger invalid winner
    // is not evidence that all smaller independently supported proposals fail.
    for (const anchor of anchors)
        for (const context of [64, 96]) {
            const c = ellipse(patch, image, anchor, context, false);
            if (!c)
                continue;
            if (c.boundary.some(p => Math.hypot(p.x - seed.x, p.y - seed.y) > .95 * radius || p.x < 0 || p.y < 0 || p.x >= image.width || p.y >= image.height))
                continue;
            c.rankScore = rank(patch, image, c);
            if (!(c.rankScore > 0) || 2 * c.major > 60 || Math.PI * c.major * c.major * c.ratio < 64)
                continue;
            const field = fit(patch.samples(image, c.center, c.major, c.ratio, c.angle, 1.15, 1.65, 2), 4);
            if (!field)
                continue;
            const core = patch.samples(image, c.center, c.major, c.ratio, c.angle, 0, .8, 1), outer = patch.samples(image, c.center, c.major, c.ratio, c.angle, 1.55, 2.05, 1);
            if (core.length < 20 || outer.length < 20)
                continue;
            const residuals = core.map(p => residual(field, p)), delta = [0, 1, 2].map(k => quantile(residuals.map(v => v[k]))) as Vec;
            const standardized = delta.map((v, k) => v / field.noise[k]), colorDistance = norm(standardized), unit = standardized.map(v => v / Math.max(1e-8, colorDistance));
            const projection = (v: Vec) => v.reduce((s, x, k) => s + x / field.noise[k] * unit[k], 0);
            const support = residuals.filter(v => projection(v) >= Math.max(.75, .4 * colorDistance)).length / core.length;
            const continued = outer.map(p => projection(residual(field, p)) >= Math.max(1.5, .5 * colorDistance));
            const continuation = continued.filter(Boolean).length / outer.length, sectors = Array.from({ length: 8 }, () => [] as boolean[]);
            outer.forEach((p, i) => sectors[Math.floor((Math.atan2(p.v, p.u) + Math.PI) * 4 / Math.PI) % 8].push(continued[i]));
            const sectorContinuation = sectors.map(v => v.length ? v.filter(Boolean).length / v.length : 1);
            // Mean support alone can hide a long strip or an incomplete arc that
            // leaves the candidate in only one or two directions.
            if (delta[0] > -1.5 || Math.max(delta[1], delta[2]) < 2.5 || colorDistance < 4 || support < .7 || continuation > .2 || Math.max(...sectorContinuation) > .25)
                continue;
            if (!best || c.rankScore > (best.candidate.rankScore ?? -Infinity))
                best = { candidate: c, evidence: { deltaLab: delta, noiseLab: field.noise,
                        whitenedDistance: colorDistance, interiorSupport: support, outerContinuation: continuation, sectorContinuation,
                        diameter: 2 * c.major, axisRatio: c.ratio, anchor: c.anchor, context: c.context, rankScore: c.rankScore } };
        }
    return best;
}
function pigmentAnchors(peaks: Point[], seed: Point): Point[] {
    const anchors: Point[] = [];
    // 保留原来的强对比候选，再给点击附近的真实图像特征留少量席位。
    // 扫描圈变大带入远处强阴影时，不能挤掉原来可识别的小目标。
    for (const pool of [peaks, peaks.slice().sort((a, b) => Math.hypot(a.x - seed.x, a.y - seed.y)
        - Math.hypot(b.x - seed.x, b.y - seed.y))]) {
        const limit = anchors.length < 8 ? 8 : 12;
        for (const anchor of pool) {
            if (anchors.some(p => Math.hypot(anchor.x - p.x, anchor.y - p.y) < 12)) continue;
            anchors.push(anchor);
            if (anchors.length >= limit) break;
        }
    }
    return anchors;
}
import type { ControlledMarkerDetection, ControlledMarkerOptions, MarkerImageData, MarkerPoint } from './controlledMarkerDetection.ts';
import { loadMarkerOpenCv } from './controlledMarkerOpenCvRuntime.ts';
function meanBoundary(boundary: Point[]): Point {
    return { x: boundary.reduce((sum, p) => sum + p.x, 0) / boundary.length,
        y: boundary.reduce((sum, p) => sum + p.y, 0) / boundary.length };
}
const MAX_APPEARANCE_BASELINE_AREA_RATIO = 1.4;
const APPEARANCE_BOUNDARY_SHRINK = 0.92;
function scaleBoundaryAround(boundary: Point[], center: Point, scale: number): Point[] {
    return boundary.map(point => ({
        x: center.x + (point.x - center.x) * scale,
        y: center.y + (point.y - center.y) * scale,
    }));
}
/**
 * 包络候选只能在已有强基线附近收缩或有限扩张。
 * 对已有足够大的同步基线先做小幅内收；如果异步候选仍然放大过多，
 * 再把面积增长限制在1.4倍。这不改变拒识、扫描覆盖或其他候选路径。
 */
function constrainAppearanceExpansion(
    baseline: ControlledMarkerDetection,
    boundary: Point[],
    route: string,
    appearanceEvidence?: Record<string, unknown>,
): { boundary: Point[]; cap?: Record<string, number> } {
    if (!baseline.ok || baseline.geometry_mode !== 'dark_component'
        || baseline.boundary.length < 3
        || (baseline.warnings || []).includes('scan_solid_direct_proposal_recovered')
        || (route !== 'material_body_envelope' && route !== 'localized_pigment_envelope'))
        return { boundary };
    const strongBodyEvidence = Number(appearanceEvidence?.interiorSupport) >= .95
        && Number(appearanceEvidence?.outerContinuation) <= .05
        && Number(appearanceEvidence?.materialDistance) >= 6;
    if (baseline.area_px < 300 && strongBodyEvidence)
        return { boundary };
    const center = meanBoundary(boundary);
    const candidateArea = polygonArea(boundary);
    const initialArea = candidateArea * APPEARANCE_BOUNDARY_SHRINK ** 2;
    const ratio = initialArea / Math.max(1, baseline.area_px);
    const capScale = ratio > MAX_APPEARANCE_BASELINE_AREA_RATIO
        ? Math.sqrt(MAX_APPEARANCE_BASELINE_AREA_RATIO / ratio)
        : 1;
    const scale = APPEARANCE_BOUNDARY_SHRINK * capScale;
    const sectorMedianProjection = Array.isArray(appearanceEvidence?.sectorMedianProjection)
        ? appearanceEvidence.sectorMedianProjection.map(Number)
        : null;
    const hasSectorEvidence = sectorMedianProjection?.length === 8
        && sectorMedianProjection.every(Number.isFinite);
    // 统一内收可能抹去有证据的短边；仅在局部证据强的扇区少收一点，
    // 其余方向仍保守内收，最后继续受整体面积上限约束。
    let constrained = boundary.map((point) => {
        if (!hasSectorEvidence) {
            return {
                x: center.x + (point.x - center.x) * scale,
                y: center.y + (point.y - center.y) * scale,
            };
        }
        const angle = (Math.atan2(point.y - center.y, point.x - center.x) + Math.PI * 2) % (Math.PI * 2);
        const sector = Math.floor(angle * 8 / (Math.PI * 2)) % 8;
        const projection = sectorMedianProjection[sector];
        const evidenceScale = projection >= 8 ? 0.97 : projection >= 3 ? 0.95 : APPEARANCE_BOUNDARY_SHRINK;
        const directionalScale = capScale * evidenceScale;
        return {
            x: center.x + (point.x - center.x) * directionalScale,
            y: center.y + (point.y - center.y) * directionalScale,
        };
    });
    const constrainedArea = polygonArea(constrained);
    const constrainedAreaCap = baseline.area_px * MAX_APPEARANCE_BASELINE_AREA_RATIO;
    if (constrainedArea > constrainedAreaCap) {
        const correction = Math.sqrt(constrainedAreaCap / Math.max(1, constrainedArea));
        constrained = scaleBoundaryAround(constrained, center, correction);
    }
    return {
        boundary: constrained,
        cap: {
            baselineAreaPx: baseline.area_px,
            originalAreaPx: candidateArea,
            constrainedAreaPx: polygonArea(constrained),
            appliedScale: scale,
            initialShrink: APPEARANCE_BOUNDARY_SHRINK,
            directionalEvidence: hasSectorEvidence ? 1 : 0,
            maxAreaRatio: MAX_APPEARANCE_BASELINE_AREA_RATIO,
        },
    };
}
function validAppearanceInput(image: MarkerImageData, seed: MarkerPoint, radius: number): boolean {
    return Number.isInteger(image.width) && Number.isInteger(image.height) && image.width > 0 && image.height > 0
        && image.data.length === image.width * image.height * 4
        && Number.isFinite(seed.x) && Number.isFinite(seed.y)
        && seed.x >= 0 && seed.y >= 0 && seed.x < image.width && seed.y < image.height
        && Number.isFinite(radius) && radius >= 12 && radius <= 400;
}
function appearanceResult(baseline: ControlledMarkerDetection, boundary: Point[], seed: Point, route: string, evidence: Record<string, unknown>): ControlledMarkerDetection {
    const regularized = regularizeAppearanceBoundary(boundary);
    const acceptedBoundary = regularized.repairedPoints > 0 && contains(seed, regularized.boundary)
        ? regularized.boundary : boundary;
    const xs = acceptedBoundary.map(p => p.x), ys = acceptedBoundary.map(p => p.y);
    const bbox = { x: Math.min(...xs), y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    const area = polygonArea(acceptedBoundary);
    const diagnostics = { ...baseline.diagnostics, filled_candidate_route: route,
        appearance_evidence: evidence, appearance_previous_failure: baseline.failure_code,
        ...(regularized.repairedPoints > 0 && acceptedBoundary === regularized.boundary ? {
            appearance_boundary_regularization: 'bounded_local_concavity',
            appearance_boundary_repaired_points: regularized.repairedPoints,
            appearance_boundary_area_ratio: Number(regularized.areaRatio.toFixed(3)),
            appearance_boundary_max_displacement_px: Number(regularized.maxDisplacement.toFixed(3)),
        } : {}) };
    return { ...baseline, ok: true, failure_code: null, boundary: acceptedBoundary, center: meanBoundary(acceptedBoundary), area_px: area, bbox,
        geometry_mode: 'dark_component', seed_relation: contains(seed, acceptedBoundary) ? 'enclosed'
            : Math.min(...acceptedBoundary.map((p, i) => segmentDistance(seed, p, acceptedBoundary[(i + 1) % acceptedBoundary.length]))) <= 3 ? 'on_marker' : 'near_marker',
        marker_area_px: Math.round(area), marker_bbox: bbox,
        confidence: baseline.ok ? baseline.confidence : .6, candidate_count: Math.max(1, baseline.candidate_count + 1),
        warnings: [...baseline.warnings, route], rejected_boundary: undefined, rejected_geometry_mode: undefined,
        rejected_reasons: undefined, diagnostics };
}
/**
 * An independently isolated pigment object may correct a concave pixel
 * recovery that contains extra neighbouring skin. This is selection of an
 * existing image-supported proposal, not circular completion of a boundary.
 * Rejected inputs and incomplete-body checks retain their existing behavior.
 */
function isolatedPigmentRecovery(
    baseline: ControlledMarkerDetection,
    candidate: Ellipse,
    evidence: Record<string, unknown>,
): boolean {
    if (!baseline.ok || baseline.geometry_mode !== 'dark_component'
        || baseline.diagnostics?.filled_candidate_route !== 'validated_recovered_pixel_boundary'
        || !baseline.warnings.includes('small_recovered_pixel_boundary_preserved')
        || baseline.boundary.length < 3)
        return false;
    const oldArea = polygonArea(baseline.boundary);
    const area = polygonArea(candidate.boundary);
    const ratio = area / Math.max(1, oldArea);
    const sectors = evidence.sectorContinuation;
    return ratio >= .4 && ratio <= .8
        && oldArea / Math.max(1, polygonArea(hull(baseline.boundary))) < .9
        && Number(evidence.interiorSupport) >= .9
        && evidence.outerContinuation === 0
        && Array.isArray(sectors) && sectors.length === 8 && sectors.every(v => v === 0)
        && contains(candidate.center, baseline.boundary)
        && convexIntersectionArea(baseline.boundary, candidate.boundary) / Math.max(1, area) >= .8;
}

function pigmentAssociated(baseline: ControlledMarkerDetection, boundary: Point[]): boolean {
    if (!baseline.ok)
        return true;
    const old = baseline.boundary, area = polygonArea(boundary), ratio = area / Math.max(1, baseline.area_px);
    if (old.length < 3 || ratio < 1 || ratio > 4)
        return false;
    const center = meanBoundary(boundary), previous = meanBoundary(old);
    if (Math.hypot(previous.x - center.x, previous.y - center.y) > .8 * Math.sqrt(area / Math.PI))
        return false;
    if (old.filter(p => contains(p, boundary)).length / old.length >= .9)
        return true;
    const points = [...boundary, ...old], xs = points.map(p => p.x), ys = points.map(p => p.y);
    let intersection = 0, union = 0;
    for (let y = Math.floor(Math.min(...ys)); y <= Math.ceil(Math.max(...ys)); y++)
        for (let x = Math.floor(Math.min(...xs)); x <= Math.ceil(Math.max(...xs)); x++) {
            const p = { x: x + .5, y: y + .5 }, a = contains(p, old), b = contains(p, boundary);
            intersection += Number(a && b);
            union += Number(a || b);
        }
    return intersection / Math.max(1, union) >= .5;
}
function shouldPreserveSupportedBaselineOnIncompleteBody(
    baseline: ControlledMarkerDetection,
    incompleteBoundary: Point[],
    analysisRadius: number,
): boolean {
    if (!baseline.ok || baseline.geometry_mode !== 'dark_component'
        || baseline.boundary.length < 3 || incompleteBoundary.length < 3)
        return false;
    const warnings = new Set(baseline.warnings || []);
    const diagnostics = baseline.diagnostics as Record<string, unknown> | undefined;
    const baselineArea = polygonArea(baseline.boundary);
    const incompleteArea = polygonArea(incompleteBoundary);
    const compactPixelRecovery = warnings.has('small_recovered_pixel_boundary_preserved')
        && Number(diagnostics?.scan_solid_proposal_count || 0) <= 7
        && Number(diagnostics?.scan_solid_proposal_consensus_count || 0) <= 5;
    // 大外观候选本身不完整时，不能仅凭它否定已有多重证据支持的小暗组件。
    return warnings.has('solid_component_outer_boundary_recovered')
        && warnings.has('scan_solid_core_anchor_recovered')
        && warnings.has('fixed_scale_unclipped_solid_anchor_recovered')
        && (warnings.has('component_too_large:radial_boundary_incomplete') || compactPixelRecovery)
        && Number(diagnostics?.solid_component_core_dark_ratio || 0) >= .95
        && Number(diagnostics?.scan_solid_proposal_consensus_count || 0) >= 2
        && baselineArea <= Math.PI * Math.max(12, analysisRadius) ** 2 * .35
        && incompleteArea > baselineArea * 1.25;
}
/** 仅候选肿物链路调用：不读取参考标注，不改扫描圈、笔圈、大目标或 RSTL。 */
async function refineAppearanceCandidateBaseline(image: MarkerImageData, seed: MarkerPoint, options: ControlledMarkerOptions, baseline: ControlledMarkerDetection): Promise<ControlledMarkerDetection> {
    const radius = Number(baseline.scan?.radius_px || options.roiRadius || 36);
    if (!validAppearanceInput(image, seed, radius)
        || baseline.ok && (baseline.geometry_mode !== 'dark_component' || baseline.area_px >= 3000))
        return baseline;
    try {
        const cv = await loadMarkerOpenCv();
        const prepared = new Patch(cv, image, seed, radius, false);
        const pigment = localizedPigmentCandidate(cv, image, seed, radius, prepared);
        let result = baseline;
        if (pigment && pigmentAssociated(baseline, pigment.candidate.boundary)) {
            const constrained = constrainAppearanceExpansion(
                baseline, pigment.candidate.boundary, 'localized_pigment_envelope', pigment.evidence,
            );
            const evidence = constrained.cap
                ? { ...pigment.evidence, appearance_expansion_cap: constrained.cap }
                : pigment.evidence;
            result = appearanceResult(baseline, constrained.boundary, seed, 'localized_pigment_envelope', evidence);
        }
        const body = materialWholeBodyCandidate(cv, image, seed, radius, result, prepared.materialView());
        if (!body) {
            const refined = refineCompactLabBody(cv, image, seed, radius, result);
            // Keep the original body association and every rejection first.
            // Only an otherwise unchanged accepted pixel recovery is eligible.
            if (refined === baseline && pigment
                && isolatedPigmentRecovery(baseline, pigment.candidate, pigment.evidence))
                return appearanceResult(baseline, pigment.candidate.boundary, seed,
                    'isolated_pigment_recovery', pigment.evidence);
            return refined;
        }
        // A uniform small mole must not be swallowed by a nearby broad colour
        // patch. A legacy fragment's centre is not an independent object label.
        const preserveUniform = pigment && Number(pigment.evidence.interiorSupport) >= .95;
        if (preserveUniform) {
            const center = meanBoundary(body.boundary);
            const pigmentCenter = pigment.candidate.center;
            if (!contains(pigmentCenter, body.boundary)
                || Math.hypot(pigmentCenter.x - center.x, pigmentCenter.y - center.y) > .4 * Math.sqrt(polygonArea(body.boundary) / Math.PI)
                || polygonArea(body.boundary) > 2 * polygonArea(pigment.candidate.boundary))
                return refineCompactLabBody(cv, image, seed, radius, result);
        }
        if (!body.scanComplete) {
            const rejected = body.incompleteBoundary ?? body.boundary;
            if (shouldPreserveSupportedBaselineOnIncompleteBody(
                baseline,
                rejected,
                Number(options.analysisRoiRadius || radius),
            )) {
                return {
                    ...baseline,
                    warnings: [...new Set([
                        ...baseline.warnings,
                        'incomplete_appearance_body_preserved_supported_baseline',
                    ])],
                    diagnostics: {
                        ...baseline.diagnostics,
                        filled_candidate_route: 'preserved_supported_baseline_on_incomplete_appearance_body',
                    },
                };
            }
            if (result.ok && result.center && !contains(result.center, rejected))
                return result;
            return { ...baseline, ok: false, failure_code: 'scan_range_too_small', center: null, boundary: [],
                area_px: 0, bbox: null, geometry_mode: null, seed_relation: null, marker_area_px: 0, marker_bbox: null,
                confidence: 0, rejected_boundary: rejected, rejected_geometry_mode: 'dark_component',
                rejected_reasons: ['appearance_candidate_outside_scan_roi'],
                warnings: [...baseline.warnings, 'appearance_candidate_outside_scan_roi'],
                diagnostics: { ...baseline.diagnostics, filled_candidate_route: 'rejected_incomplete_appearance_body' } };
        }
        const constrained = constrainAppearanceExpansion(baseline, body.boundary, 'material_body_envelope', body.evidence);
        const evidence = constrained.cap
            ? { ...body.evidence, appearance_expansion_cap: constrained.cap }
            : body.evidence;
        const materialResult = appearanceResult(baseline, constrained.boundary, seed, 'material_body_envelope', evidence);
        // A complete broad proposal can lose the supported object when its
        // area cap shrinks around a displaced centre. Preserve the evaluated
        // local object only after the unchanged completeness checks above.
        const refined = refineCompactLabBody(cv, image, seed, radius, materialResult);
        if (refined.ok && result.ok && result.center
            && !contains(result.center, materialResult.boundary))
            return result;
        return refined;
    }
    catch {
        // A failed optional refinement cannot discard an already evaluated result.
        return { ...baseline, warnings: [...baseline.warnings, 'appearance_refinement_unavailable'] };
    }
}
export const __appearanceGeometryForTests = {
    polygonArea, polygonCentroid, convexIntersectionArea, selectCompleteBodyCandidate,
    constrainAppearanceExpansion, associateBodyCandidates, pigmentAnchors,
    regularizeAppearanceBoundary,
};

type CompactPigmentProposal = {
    candidate: Ellipse;
    evidence: Record<string, unknown>;
};
type CompactPigmentSupport = {
    kind: 'separate_anchors' | 'two_background_contexts';
    anchor: Point;
    context: number;
    peerAnchor: Point;
    peerContext: number;
    overlapIou: number;
};
function compactPigmentSupport(
    proposal: CompactPigmentProposal, bank: CompactPigmentProposal[],
): CompactPigmentSupport | null {
    const isolated = (item: CompactPigmentProposal) => Number(item.evidence.interiorSupport) >= .95
        && item.evidence.outerContinuation === 0 && Array.isArray(item.evidence.sectorContinuation)
        && item.evidence.sectorContinuation.length === 8
        && item.evidence.sectorContinuation.every(value => value === 0);
    for (const peer of bank) {
        if (peer === proposal) continue;
        const a = proposal.candidate, b = peer.candidate;
        const intersection = convexIntersectionArea(a.boundary, b.boundary);
        const overlapIou = intersection / Math.max(1e-8,
            polygonArea(a.boundary) + polygonArea(b.boundary) - intersection);
        const separate = Math.hypot(a.anchor.x - b.anchor.x, a.anchor.y - b.anchor.y) >= 8
            && overlapIou >= .7;
        const stableBackground = [a.context, b.context].sort((x, y) => x - y).join(',') === '64,96'
            && isolated(proposal) && isolated(peer) && overlapIou >= .9;
        if (separate || stableBackground) return {
            kind: separate ? 'separate_anchors' : 'two_background_contexts',
            anchor: a.anchor, context: a.context, peerAnchor: b.anchor,
            peerContext: b.context, overlapIou,
        };
    }
    return null;
}
function compactPigmentRecovery(
    cv: CV, image: MarkerImageData, seed: MarkerPoint, radius: number,
): { proposal: CompactPigmentProposal; support: CompactPigmentSupport } | null {
    const patch = new Patch(cv, image, seed, radius, false);
    const bank: CompactPigmentProposal[] = [];
    for (const anchor of pigmentAnchors(patch.anchors, seed))
        for (const context of [24, 32, 48, 64, 96]) {
            // A clipped background cannot certify an isolated object.
            if (anchor.x - .95 * context < 0 || anchor.y - .95 * context < 0
                || anchor.x + .95 * context >= image.width
                || anchor.y + .95 * context >= image.height) continue;
            const c = ellipse(patch, image, anchor, context, false);
            if (!c || c.boundary.some(point => Math.hypot(point.x - seed.x, point.y - seed.y) > .95 * radius))
                continue;
            const backgroundReach = 2.05 * c.major;
            if (c.center.x - backgroundReach < 0 || c.center.y - backgroundReach < 0
                || c.center.x + backgroundReach >= image.width
                || c.center.y + backgroundReach >= image.height) continue;
            c.rankScore = rank(patch, image, c);
            if (!(c.rankScore > 0) || 2 * c.major > 60
                || Math.PI * c.major * c.major * c.ratio < 64) continue;
            const field = fit(patch.samples(image, c.center, c.major, c.ratio, c.angle, 1.15, 1.65, 2), 4);
            if (!field) continue;
            const core = patch.samples(image, c.center, c.major, c.ratio, c.angle, 0, .8, 1);
            const outer = patch.samples(image, c.center, c.major, c.ratio, c.angle, 1.55, 2.05, 1);
            if (core.length < 20 || outer.length < 20) continue;
            const residuals = core.map(point => residual(field, point));
            const delta = [0, 1, 2].map(k => quantile(residuals.map(value => value[k]))) as Vec;
            const standardized = delta.map((value, k) => value / field.noise[k]);
            const strength = norm(standardized), unit = standardized.map(value => value / Math.max(1e-8, strength));
            const projection = (value: Vec) => value.reduce((sum, item, k) => sum + item / field.noise[k] * unit[k], 0);
            const interiorSupport = residuals.filter(value =>
                projection(value) >= Math.max(.75, .4 * strength)).length / core.length;
            const continued = outer.map(point => projection(residual(field, point)) >= Math.max(1.5, .5 * strength));
            const outerContinuation = continued.filter(Boolean).length / outer.length;
            const sectors = Array.from({ length: 8 }, () => [] as boolean[]);
            outer.forEach((point, index) =>
                sectors[Math.floor((Math.atan2(point.v, point.u) + Math.PI) * 4 / Math.PI) % 8].push(continued[index]));
            const sectorContinuation = sectors.map(values =>
                values.length ? values.filter(Boolean).length / values.length : 1);
            if (delta[0] > -1.5 || Math.hypot(delta[1], delta[2]) < 2.5 || strength < 4
                || interiorSupport < .7 || outerContinuation > .2 || Math.max(...sectorContinuation) > .25)
                continue;
            bank.push({ candidate: c, evidence: {
                deltaLab: delta, noiseLab: field.noise, whitenedDistance: strength,
                interiorSupport, outerContinuation, sectorContinuation,
                diameter: 2 * c.major, axisRatio: c.ratio, anchor: c.anchor,
                context: c.context, rankScore: c.rankScore,
            } });
        }
    const eligible = bank.map(proposal => ({ proposal, support: compactPigmentSupport(proposal, bank) }))
        .filter((item): item is { proposal: CompactPigmentProposal; support: CompactPigmentSupport } => !!item.support)
        .sort((a, b) => (b.proposal.candidate.rankScore ?? -Infinity) - (a.proposal.candidate.rankScore ?? -Infinity));
    const selected = eligible[0];
    if (!selected) return null;
    // Several stable objects in one scan remain ambiguous.
    const selectedArea = polygonArea(selected.proposal.candidate.boundary);
    if (eligible.some(peer => convexIntersectionArea(selected.proposal.candidate.boundary,
        peer.proposal.candidate.boundary) / Math.max(1, Math.min(selectedArea,
        polygonArea(peer.proposal.candidate.boundary))) < .5)) return null;
    return selected;
}
/** Supplemental recovery cannot replace an accepted result or a coverage veto. */
export async function refineAppearanceCandidate(
    image: MarkerImageData, seed: MarkerPoint, options: ControlledMarkerOptions,
    baseline: ControlledMarkerDetection,
): Promise<ControlledMarkerDetection> {
    const existing = await refineAppearanceCandidateBaseline(image, seed, options, baseline);
    const coverageReasons = new Set([
        'not_enclosed_within_scan', 'candidate_outside_scan_roi',
        'appearance_candidate_outside_scan_roi', 'scan_range_too_small',
    ]);
    if (existing.ok || existing.failure_code !== 'unstable_enclosure'
        || (existing.warnings || []).some(warning => warning.includes('unavailable'))
        || (existing.rejected_reasons || []).some(reason => coverageReasons.has(reason))
        || String(existing.diagnostics?.filled_candidate_route || '').startsWith('rejected_incomplete_'))
        return existing;
    const radius = Number(baseline.scan?.radius_px || options.roiRadius || 36);
    if (!validAppearanceInput(image, seed, radius)) return existing;
    try {
        const recovered = compactPigmentRecovery(await loadMarkerOpenCv(), image, seed, radius);
        if (!recovered) return existing;
        return appearanceResult(existing, recovered.proposal.candidate.boundary, seed, 'compact_color_recovery', {
            ...recovered.proposal.evidence,
            recoverySupport: recovered.support,
            previousRejection: { failureCode: existing.failure_code, reasons: existing.rejected_reasons || [],
                route: existing.diagnostics?.filled_candidate_route || null },
        });
    } catch {
        return existing;
    }
}
