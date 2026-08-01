"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const validator_1 = require("./validator");
(0, vitest_1.describe)('divisionEquipo updateSchema', () => {
    vitest_1.it.each([
        ['0', '0.00'],
        ['0001.2', '1.20'],
        ['12.3', '12.30'],
        ['9999999999.99', '9999999999.99'],
    ])('accepts %s and emits a canonical string', (input, expected) => {
        (0, vitest_1.expect)(validator_1.updateSchema.parse({ saldoPendiente: input })).toEqual({ saldoPendiente: expected });
    });
    vitest_1.it.each([
        {},
        { saldoPendiente: 1 },
        { saldoPendiente: '-1' },
        { saldoPendiente: '+1' },
        { saldoPendiente: '1.234' },
        { saldoPendiente: '.50' },
        { saldoPendiente: '1.' },
        { saldoPendiente: ' 1.00' },
        { saldoPendiente: '10000000000.00' },
        { saldoPendiente: '1.00', extra: true },
    ])('rejects invalid or non-strict payload %#', (payload) => {
        (0, vitest_1.expect)(validator_1.updateSchema.safeParse(payload).success).toBe(false);
    });
});
//# sourceMappingURL=validator.test.js.map