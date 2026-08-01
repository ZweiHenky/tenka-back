"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const validator_1 = require("./validator");
(0, vitest_1.describe)('equipo nombre validator', () => {
    (0, vitest_1.it)('recorta el nombre al crear y actualizar', () => {
        (0, vitest_1.expect)(validator_1.createSchema.parse({ nombre: '  Halcones  ', userId: 'user-1' }).nombre).toBe('Halcones');
        (0, vitest_1.expect)(validator_1.updateSchema.parse({ nombre: '  Leones  ' }).nombre).toBe('Leones');
    });
    (0, vitest_1.it)('rechaza un nombre compuesto solo por espacios', () => {
        (0, vitest_1.expect)(validator_1.createSchema.safeParse({ nombre: '   ', userId: 'user-1' }).success).toBe(false);
    });
});
//# sourceMappingURL=validator.test.js.map