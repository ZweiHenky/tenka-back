import { describe, expect, it, vi } from 'vitest';

vi.mock('../../config/database', async () => (await import('./service.test-mocks')).databaseModuleMock);
vi.mock('./repository', async () => (await import('./service.test-mocks')).repositoryModuleMock);
vi.mock('../tabla-posicion/service', async () => (await import('./service.test-mocks')).tablaPosicionModuleMock);
vi.mock('../ronda-playoff/service', async () => (await import('./service.test-mocks')).rondaPlayoffModuleMock);

import { findDeterministicMatching } from './service.test-harness';

describe('findDeterministicMatching', () => {
  it('finds the complete matching with the lowest aggregate frequency', () => {
    const occurrences = new Map([
      ['a|b', 0], ['c|d', 10],
      ['a|c', 1], ['b|d', 1],
      ['a|d', 3], ['b|c', 3],
    ])

    expect(findDeterministicMatching(['d', 'b', 'a', 'c'], occurrences)).toEqual([
      ['a', 'c'], ['b', 'd'],
    ]);
  });

  it('uses a deterministic lexical tie-break', () => {
    expect(findDeterministicMatching(['d', 'b', 'a', 'c'], new Map())).toEqual([
      ['a', 'b'], ['c', 'd'],
    ])
  })

  it('allows repeats when every pairing has occurred', () => {
    expect(findDeterministicMatching(['a', 'b'], new Map([['a|b', 4]]))).toEqual([['a', 'b']])
  })

  it('returns null for malformed participant sets', () => {
    expect(findDeterministicMatching(['a', 'a'], new Map())).toBeNull();
    expect(findDeterministicMatching(['a'], new Map())).toBeNull();
  });

  it('returns a deterministic perfect matching for 32 teams', () => {
    const teams = Array.from({ length: 32 }, (_, index) => `team-${String(index + 1).padStart(2, '0')}`)
    const occurrences = new Map<string, number>()
    for (let i = 0; i < teams.length; i++) {
      for (let j = i + 1; j < teams.length; j++) {
        occurrences.set(`${teams[i]}|${teams[j]}`, (i * 7 + j * 11) % 5)
      }
    }

    const first = findDeterministicMatching([...teams].reverse(), occurrences)
    const second = findDeterministicMatching([...teams.slice(16), ...teams.slice(0, 16)], occurrences)

    expect(first).toEqual(second)
    expect(first).toHaveLength(16)
    expect(new Set(first!.flat())).toEqual(new Set(teams))
  })
});
