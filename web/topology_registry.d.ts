export interface TopologyMeta {
  id: string;
  version: string;
  label: string;
  bundled: boolean;
}

export const TOPOLOGIES: TopologyMeta[];
export function topologyMeta(id: string): TopologyMeta;
