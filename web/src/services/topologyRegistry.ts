export interface TopologyMeta {
  id: string;
  version: string;
  label: string;
  bundled: boolean;
}

export const TOPOLOGIES: TopologyMeta[] = [
  { id: "mediapipe-468", version: "mediapipe-canonical-468-v1", label: "标准脸 (MediaPipe 468)", bundled: true },
  { id: "flame-2023", version: "flame-2023-v1", label: "FLAME 头模 (5023)", bundled: false },
];

export function topologyMeta(id: string): TopologyMeta | null {
  return TOPOLOGIES.find((topology) => topology.id === id) || null;
}
