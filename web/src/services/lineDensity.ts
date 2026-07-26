type AtlasLine = {
  name?: string;
  symmetryPairId?: string;
  symmetryRole?: string;
};

const clamp01 = (value: number) => Math.max(0, Math.min(1, Number(value) || 0));

function mirroredLineName(name = ""): string {
  if (name.includes("_left_")) return name.replace("_left_", "_right_");
  if (name.includes("_right_")) return name.replace("_right_", "_left_");
  if (name.endsWith("_left")) return `${name.slice(0, -5)}_right`;
  if (name.endsWith("_right")) return `${name.slice(0, -6)}_left`;
  if (name.endsWith("_l")) return `${name.slice(0, -2)}_r`;
  if (name.endsWith("_r")) return `${name.slice(0, -2)}_l`;
  return "";
}

function symmetryGroups(lines: AtlasLine[]): number[][] {
  const names = new Map<string, number>();
  const pairIds = new Map<string, number[]>();
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] || {};
    if (line.name) names.set(line.name, index);
    if (line.symmetryPairId && line.symmetryRole !== "midline" && line.symmetryRole !== "bilateral") {
      const peers = pairIds.get(line.symmetryPairId) || [];
      peers.push(index);
      pairIds.set(line.symmetryPairId, peers);
    }
  }

  const used = new Set<number>();
  const groups: number[][] = [];
  for (let index = 0; index < lines.length; index++) {
    if (used.has(index)) continue;
    const line = lines[index] || {};
    let members: number[] = [];
    if (line.symmetryPairId && pairIds.has(line.symmetryPairId)) {
      members = (pairIds.get(line.symmetryPairId) || []).filter((peer) => !used.has(peer));
    }
    if (members.length < 2) {
      const mirrorIndex = names.get(mirroredLineName(line.name));
      members = Number.isInteger(mirrorIndex) && !used.has(mirrorIndex as number)
        ? [index, mirrorIndex as number]
        : [index];
    }
    members = [...new Set(members)].sort((a, b) => a - b);
    for (const member of members) used.add(member);
    groups.push(members);
  }
  return groups;
}

function evenlySpacedGroupIndices(groupCount: number, selectedCount: number): number[] {
  const indices: number[] = [];
  for (let slot = 0; slot < selectedCount; slot++) {
    indices.push(Math.floor(((slot + 0.5) * groupCount) / selectedCount));
  }
  return indices;
}

// Density is applied to complete symmetry groups so paired left/right curves
// appear and disappear together at every density setting.
export function lineIndicesForDensity(lines: AtlasLine[], densityFraction: number): Set<number> {
  if (!Array.isArray(lines) || lines.length === 0) return new Set();
  const density = clamp01(densityFraction);
  if (density <= 0) return new Set();
  if (density >= 0.999) return new Set(lines.map((_, index) => index));

  const groups = symmetryGroups(lines);
  const selectedGroupCount = Math.max(1, Math.round(groups.length * density));
  const visible = new Set<number>();
  for (const groupIndex of evenlySpacedGroupIndices(groups.length, selectedGroupCount)) {
    for (const lineIndex of groups[groupIndex]) visible.add(lineIndex);
  }
  return visible;
}
