// 从 RSTL/Langer 图谱算每顶点的"局部张力线方向"（单位切向），供 soft_body 的各向异性刚度用。
// 输入：canonical verts(N×3) / tris(M×3) / atlas（lines[].points = [[tri,u,v], ...]）。
// 做法：把图谱线点还原成 3D + 取相邻差为切向；每顶点取最近图谱点的切向。纯函数、可 Node 单测。
const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

export function rstlDirField(verts, tris, atlas) {
  const pts = [], tans = [];
  for (const ln of atlas.lines || []) {
    const P = (ln.points || []).map(([tri, u, v]) => {
      const t = tris[tri] || [0, 0, 0], w = 1 - u - v;
      const A = verts[t[0]], B = verts[t[1]], C = verts[t[2]];
      return [u * A[0] + v * B[0] + w * C[0], u * A[1] + v * B[1] + w * C[1], u * A[2] + v * B[2] + w * C[2]];
    });
    for (let i = 0; i < P.length; i++) {
      const a = P[Math.max(0, i - 1)], b = P[Math.min(P.length - 1, i + 1)];
      pts.push(P[i]);
      tans.push(norm([b[0] - a[0], b[1] - a[1], b[2] - a[2]]));
    }
  }
  const field = new Array(verts.length);
  for (let i = 0; i < verts.length; i++) {
    let best = 0, bd = Infinity;
    for (let j = 0; j < pts.length; j++) {
      const dx = verts[i][0] - pts[j][0], dy = verts[i][1] - pts[j][1], dz = verts[i][2] - pts[j][2];
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bd) { bd = d; best = j; }
    }
    field[i] = pts.length ? tans[best] : [1, 0, 0];
  }
  return field;
}
