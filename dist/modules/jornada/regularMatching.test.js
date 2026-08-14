"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const regularMatching_1 = require("./regularMatching");
const teams = (count) => Array.from({ length: count }, (_, index) => ({ id: `team-${String(index + 1).padStart(2, '0')}` }));
function pairs(matching) {
    return [...matching.entries()]
        .map(([a, b]) => [a, b].sort().join('|'))
        .filter((pair, index, all) => all.indexOf(pair) === index)
        .sort();
}
(0, vitest_1.describe)('computeMinimumHistoryMatching', () => {
    (0, vitest_1.it)('chooses a complete combination without historical repeats when available', () => {
        const repeated = new Set(['team-01|team-02', 'team-03|team-04']);
        const result = (0, regularMatching_1.computeMinimumHistoryMatching)({
            teams: teams(4),
            fixedTeamIds: new Set(),
            matchCount: (a, b) => repeated.has([a, b].sort().join('|')) ? 1 : 0,
        });
        (0, vitest_1.expect)(pairs(result).every((pair) => !repeated.has(pair))).toBe(true);
    });
    (0, vitest_1.it)('does not match two teams fixed in different partial slots', () => {
        const result = (0, regularMatching_1.computeMinimumHistoryMatching)({ teams: teams(4), fixedTeamIds: new Set(['team-01', 'team-02']), matchCount: () => 0 });
        (0, vitest_1.expect)(result.get('team-01')).not.toBe('team-02');
    });
    (0, vitest_1.it)('matches forty teams deterministically', () => {
        const input = { teams: teams(40), fixedTeamIds: new Set(), matchCount: (a, b) => (a.charCodeAt(6) + b.charCodeAt(6)) % 4 };
        const first = (0, regularMatching_1.computeMinimumHistoryMatching)(input);
        const second = (0, regularMatching_1.computeMinimumHistoryMatching)(input);
        (0, vitest_1.expect)(first.size).toBe(40);
        (0, vitest_1.expect)(pairs(first)).toHaveLength(20);
        (0, vitest_1.expect)(pairs(first)).toEqual(pairs(second));
    });
});
//# sourceMappingURL=regularMatching.test.js.map