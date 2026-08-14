"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_PAGE_SIZE = void 0;
exports.parsePagination = parsePagination;
const zod_1 = require("zod");
const errors_1 = require("./errors");
exports.MAX_PAGE_SIZE = 100;
const paginationSchema = zod_1.z.object({
    page: zod_1.z.coerce.number().int().min(1).max(1000000),
    limit: zod_1.z.coerce.number().int().min(1).max(exports.MAX_PAGE_SIZE),
});
function parsePagination(query) {
    const parsed = paginationSchema.safeParse(query);
    if (!parsed.success) {
        throw new errors_1.ValidationError(`page y limit son obligatorios; deben ser enteros positivos y limit no puede superar ${exports.MAX_PAGE_SIZE}`);
    }
    return {
        ...parsed.data,
        skip: (parsed.data.page - 1) * parsed.data.limit,
        take: parsed.data.limit,
    };
}
//# sourceMappingURL=pagination.js.map