"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const validator_1 = require("./validator");
(0, vitest_1.describe)('partido updateSchema', () => {
    vitest_1.it.each(['canchaId', 'fecha', 'fechaFin'])('rejects structural field %s', (field) => {
        (0, vitest_1.expect)(validator_1.updateSchema.safeParse({ [field]: '2099-01-01T18:00:00.000Z' }).success).toBe(false);
    });
    (0, vitest_1.it)('keeps score and one-team swap updates available', () => {
        (0, vitest_1.expect)(validator_1.updateSchema.safeParse({ golesLocal: 2, golesVisitante: 1 }).success).toBe(true);
        (0, vitest_1.expect)(validator_1.updateSchema.safeParse({ equipoLocalId: 'team-2' }).success).toBe(true);
    });
});
//# sourceMappingURL=validator.test.js.map