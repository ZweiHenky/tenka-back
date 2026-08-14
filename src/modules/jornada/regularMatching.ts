import blossom from 'edmonds-blossom';

export interface MatchingTeam {
  id: string;
}

export interface RegularMatchingInput {
  teams: MatchingTeam[];
  fixedTeamIds: Set<string>;
  matchCount: (a: string, b: string) => number;
}

export function computeMinimumHistoryMatching({ teams, fixedTeamIds, matchCount }: RegularMatchingInput): Map<string, string> {
  if (teams.length === 0) return new Map();
  const sorted = [...teams].sort((a, b) => a.id.localeCompare(b.id));
  let maxHistory = 0;
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      maxHistory = Math.max(maxHistory, matchCount(sorted[i].id, sorted[j].id));
    }
  }

  const edgeCount = sorted.length * sorted.length;
  const historyWeight = sorted.length ** 3 + 1;
  const edges: number[][] = [];
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      if (fixedTeamIds.has(sorted[i].id) && fixedTeamIds.has(sorted[j].id)) continue;
      const deterministicTieBreak = edgeCount - (i * sorted.length + j);
      const weight = (maxHistory - matchCount(sorted[i].id, sorted[j].id) + 1) * historyWeight + deterministicTieBreak;
      edges.push([i, j, weight]);
    }
  }

  const result = blossom(edges, true);
  const matching = new Map<string, string>();
  for (let i = 0; i < sorted.length; i += 1) {
    const partner = result[i];
    if (partner == null || partner < 0) continue;
    matching.set(sorted[i].id, sorted[partner].id);
  }
  return matching;
}
