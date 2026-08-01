"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const validator_1 = require("./validator");
(0, vitest_1.describe)('ronda playoff generation validation', () => {
    vitest_1.it.each([2, 4, 8, 16, 32])('accepts supported team count %i', (cantidadEquipos) => {
        (0, vitest_1.expect)(validator_1.generateSchema.safeParse({ divisionId: 'division-1', cantidadEquipos }).success).toBe(true);
    });
    vitest_1.it.each([1, 3, 6, 64])('rejects unsupported team count %i with the supported values', (cantidadEquipos) => {
        const result = validator_1.generateSchema.safeParse({ divisionId: 'division-1', cantidadEquipos });
        (0, vitest_1.expect)(result.success).toBe(false);
        if (!result.success)
            (0, vitest_1.expect)(result.error.issues[0].message).toBe('Debe ser 2, 4, 8, 16 o 32');
    });
});
//# sourceMappingURL=validator.test.js.map