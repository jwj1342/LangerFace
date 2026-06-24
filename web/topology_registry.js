// 已知拓扑登记表。两轨独立：每套拓扑有稳定 id/version，图谱按 #65 守卫互不误食。
//   mediapipe-468 —— 2D 轨标准脸，随包内置（恒在）。
//   flame-2023    —— 3D 轨 FLAME 头模，dev-local（gitignore）：本地放好
//                    assets/flame/flame2023_Open.pkl 并运行 tools/export_flame_topology.py 后，
//                    web/assets/ 出现 topology_flame_2023.json + flame_neutral_vertices.json 方可用。
export const TOPOLOGIES = [
  { id: "mediapipe-468", version: "mediapipe-canonical-468-v1", label: "标准脸 (MediaPipe 468)", bundled: true },
  { id: "flame-2023", version: "flame-2023-v1", label: "FLAME 头模 (5023)", bundled: false },
];

export function topologyMeta(id) {
  return TOPOLOGIES.find((t) => t.id === id) || null;
}
