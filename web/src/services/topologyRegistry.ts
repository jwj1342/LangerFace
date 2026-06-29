export interface TopologyMeta {
  id: string;
  version: string;
  label: string;
  bundled: boolean;
}

export const TOPOLOGIES: TopologyMeta[] = [
  { id: "mediapipe-468", version: "mediapipe-canonical-468-v1", label: "标准三维面部模型", bundled: true },
  { id: "flame-2023", version: "flame-2023-v1", label: "高精度三维头模", bundled: false },
];

export function topologyMeta(id: string): TopologyMeta | null {
  return TOPOLOGIES.find((topology) => topology.id === id) || null;
}
