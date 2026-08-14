import { describe, expect, it } from 'vitest';
import { computeMinimumHistoryMatching } from './regularMatching';

const teams = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `team-${String(index + 1).padStart(2, '0')}` }));

function pairs(matching: Map<string, string>): string[] {
  return [...matching.entries()]
    .map(([a, b]) => [a, b].sort().join('|'))
    .filter((pair, index, all) => all.indexOf(pair) === index)
    .sort();
}

describe('computeMinimumHistoryMatching', () => {
  it('chooses a complete combination without historical repeats when available', () => {
    const repeated = new Set(['team-01|team-02', 'team-03|team-04']);
    const result = computeMinimumHistoryMatching({
      teams: teams(4),
      fixedTeamIds: new Set(),
      matchCount: (a, b) => repeated.has([a, b].sort().join('|')) ? 1 : 0,
    });
    expect(pairs(result).every((pair) => !repeated.has(pair))).toBe(true);
  });

  it('does not match two teams fixed in different partial slots', () => {
    const result = computeMinimumHistoryMatching({ teams: teams(4), fixedTeamIds: new Set(['team-01', 'team-02']), matchCount: () => 0 });
    expect(result.get('team-01')).not.toBe('team-02');
  });

  it('matches forty teams deterministically', () => {
    const input = { teams: teams(40), fixedTeamIds: new Set<string>(), matchCount: (a: string, b: string) => (a.charCodeAt(6) + b.charCodeAt(6)) % 4 };
    const first = computeMinimumHistoryMatching(input);
    const second = computeMinimumHistoryMatching(input);
    expect(first.size).toBe(40);
    expect(pairs(first)).toHaveLength(20);
    expect(pairs(first)).toEqual(pairs(second));
  });
});
