import { describe, expect, it } from 'vitest';
import { getTeamCode } from './teamCode';

describe('getTeamCode', () => {
  it('returns a stable four-character uppercase code', () => {
    expect(getTeamCode('cm-team-ab12')).toBe('AB12');
    expect(getTeamCode('cm-team-ab12')).toBe('AB12');
  });

  it('removes separators and pads short identifiers', () => {
    expect(getTeamCode('a-1')).toBe('00A1');
  });
});
