"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const pagination_1 = require("./pagination");
(0, vitest_1.describe)('parsePagination', () => {
    (0, vitest_1.it)('returns bounded database offsets', () => {
        (0, vitest_1.expect)((0, pagination_1.parsePagination)({ page: '3', limit: '25' })).toEqual({ page: 3, limit: 25, skip: 50, take: 25 });
    });
    vitest_1.it.each([
        {},
        { page: '1' },
        { page: '0', limit: '10' },
        { page: '1', limit: '101' },
        { page: 'one', limit: '10' },
    ])('rejects missing or invalid pagination: %j', (query) => {
        (0, vitest_1.expect)(() => (0, pagination_1.parsePagination)(query)).toThrow('page y limit son obligatorios');
    });
});
//# sourceMappingURL=pagination.test.js.map