"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.availabilityRangeSchema = void 0;
const zod_1 = require("zod");
const isoDateTime = zod_1.z.string().datetime({ offset: true });
exports.availabilityRangeSchema = zod_1.z.object({
    inicio: isoDateTime,
    fin: isoDateTime,
}).superRefine(({ inicio, fin }, context) => {
    const start = new Date(inicio).getTime();
    const end = new Date(fin).getTime();
    if (end <= start) {
        context.addIssue({ code: 'custom', path: ['fin'], message: 'fin debe ser posterior a inicio' });
    }
    else if (end - start > 31 * 24 * 60 * 60 * 1000) {
        context.addIssue({ code: 'custom', path: ['fin'], message: 'El rango no puede exceder 31 dias' });
    }
}).transform(({ inicio, fin }) => ({ inicio: new Date(inicio), fin: new Date(fin) }));
//# sourceMappingURL=validator.js.map