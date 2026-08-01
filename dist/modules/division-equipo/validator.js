"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateSchema = exports.createSchema = void 0;
const zod_1 = require("zod");
exports.createSchema = zod_1.z.object({
    divisionId: zod_1.z.string().min(1),
    equipoId: zod_1.z.string().min(1),
});
exports.updateSchema = zod_1.z.object({
    saldoPendiente: zod_1.z.string()
        .regex(/^\d{1,10}(?:\.\d{1,2})?$/, 'El saldo pendiente debe ser un decimal no negativo con máximo 2 decimales')
        .transform((value) => {
        const [integer, decimal = ''] = value.split('.');
        const canonicalInteger = integer.replace(/^0+(?=\d)/, '');
        return `${canonicalInteger}.${decimal.padEnd(2, '0')}`;
    }),
}).strict();
//# sourceMappingURL=validator.js.map