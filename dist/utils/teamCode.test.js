"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const teamCode_1 = require("./teamCode");
(0, vitest_1.describe)('getTeamCode', () => {
    (0, vitest_1.it)('returns a stable four-character uppercase code', () => {
        (0, vitest_1.expect)((0, teamCode_1.getTeamCode)('cm-team-ab12')).toBe('AB12');
        (0, vitest_1.expect)((0, teamCode_1.getTeamCode)('cm-team-ab12')).toBe('AB12');
    });
    (0, vitest_1.it)('removes separators and pads short identifiers', () => {
        (0, vitest_1.expect)((0, teamCode_1.getTeamCode)('a-1')).toBe('00A1');
    });
});
//# sourceMappingURL=teamCode.test.js.map