// 网页 3D 标注的纯数据模型（无 Three.js / DOM 依赖，可 node 单测）。
// 医生在 3D 头模/标准脸上画 RSTL/Langer 线，导出为项目的图谱格式（重心坐标）
// 或通用 3D 折线（xyz），分别用于「直接做图谱/临床校验」与「头模管线」。

// 3D 点 p 在三角形 (a,b,c) 中的重心坐标 [u,v,w]，满足 p ≈ u·a + v·b + w·c。
// 约定与 langerface 的图谱一致：点存为 [tri, u, v]，w = 1 - u - v。
export function barycentric(p, a, b, c) {
  const v0 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v1 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const v2 = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const dot = (x, y) => x[0] * y[0] + x[1] * y[1] + x[2] * y[2];
  const d00 = dot(v0, v0), d01 = dot(v0, v1), d11 = dot(v1, v1);
  const d20 = dot(v2, v0), d21 = dot(v2, v1);
  const denom = d00 * d11 - d01 * d01 || 1e-12;
  const v = (d11 * d20 - d01 * d21) / denom;
  const w = (d00 * d21 - d01 * d20) / denom;
  return [1 - v - w, v, w];
}

const round6 = (x) => Math.round(x * 1e6) / 1e6;

// 一个标注点：xyz=世界坐标；tri/bary 仅在标注于已知三角拓扑（如标准脸）时存在。
//   { xyz:[x,y,z], tri:int|null, bary:[u,v,w]|null }
export class AnnotationModel {
  constructor(system = "rstl") {
    this.system = system;
    this.lines = [];      // 已完成的线：{ name, region, points:[pt,...] }
    this.current = null;  // 正在画的线
  }

  startLine({ name, region } = {}) {
    this.current = { name: name || `line_${this.lines.length + 1}`, region: region || "", points: [] };
  }

  addPoint(pt) {
    if (!this.current) this.startLine();
    this.current.points.push(pt);
  }

  undoPoint() {
    if (this.current && this.current.points.length) this.current.points.pop();
  }

  finishLine() {
    if (this.current && this.current.points.length >= 2) this.lines.push(this.current);
    const done = this.current;
    this.current = null;
    return done;
  }

  cancelLine() { this.current = null; }

  deleteLine(i) { if (i >= 0 && i < this.lines.length) this.lines.splice(i, 1); }

  clear() { this.lines = []; this.current = null; }

  // 每条已完成线的每个点是否都带三角拓扑（决定能否导出图谱格式）
  hasBarycentric() {
    return this.lines.length > 0 && this.lines.every(
      (l) => l.points.every((p) => p.tri != null && Array.isArray(p.bary)),
    );
  }

  // 导出为 langerface 图谱格式（点 = [tri, u, v]）。需所有点带重心坐标。
  toAtlasJSON({ version = "0.1", provenance = "web-annotator" } = {}) {
    if (!this.hasBarycentric()) {
      throw new Error("存在不含三角拓扑的点，无法导出图谱格式（请在标准脸网格上标注）");
    }
    return {
      system: this.system,
      version,
      provenance,
      validated: false,
      lines: this.lines.map((l) => ({
        name: l.name,
        region: l.region,
        points: l.points.map((p) => [p.tri, round6(p.bary[0]), round6(p.bary[1])]),
      })),
    };
  }

  // 导出为通用 3D 折线（xyz），用于任意头模（与 headspace 管线的 *_xyz 兼容）。
  toXyzJSON() {
    return {
      system: this.system,
      lines: this.lines.map((l) => ({
        name: l.name,
        region: l.region,
        points: l.points.map((p) => [round6(p.xyz[0]), round6(p.xyz[1]), round6(p.xyz[2])]),
      })),
    };
  }
}
