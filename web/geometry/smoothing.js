// One-Euro 时间平滑（与 Python detection/smoothing.py 的 LandmarkSmoother 等价）。
// 纯逻辑、无 DOM。拆分自原 web/geometry.js（见 #49）。

// One-Euro 时间平滑。对 [[x,y,z]...] 逐元素滤波。
export class OneEuro {
  constructor({ minCutoff = 1.5, beta = 0.05, dcutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dcutoff = dcutoff;
    this.xPrev = null;
    this.dxPrev = null;
    this.tPrev = null;
  }
  reset() { this.xPrev = this.dxPrev = this.tPrev = null; }
  _alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }
  filter(x, t) {
    const N = x.length;
    if (this.xPrev === null) {
      this.xPrev = x.map((p) => p.slice());
      this.dxPrev = x.map(() => [0, 0, 0]);
      this.tPrev = t;
      return x;
    }
    let dt = t - this.tPrev;
    if (dt <= 0) dt = 1e-3;
    this.tPrev = t;
    const aD = this._alpha(this.dcutoff, dt);
    const out = new Array(N);
    for (let i = 0; i < N; i++) {
      out[i] = [0, 0, 0];
      for (let k = 0; k < 3; k++) {
        const dx = (x[i][k] - this.xPrev[i][k]) / dt;
        const dxHat = aD * dx + (1 - aD) * this.dxPrev[i][k];
        this.dxPrev[i][k] = dxHat;
        const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
        const a = 1 / (1 + 1 / (2 * Math.PI * cutoff) / dt);
        const xHat = a * x[i][k] + (1 - a) * this.xPrev[i][k];
        this.xPrev[i][k] = xHat;
        out[i][k] = xHat;
      }
    }
    return out;
  }
}
