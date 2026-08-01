"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.asignacionesLigaSchema = void 0;
const zod_1 = require("zod");
exports.asignacionesLigaSchema = zod_1.z.object({
    asignacionId: zod_1.z.string().optional(),
    divisionIds: zod_1.z.array(zod_1.z.string()),
    asignaciones: zod_1.z.array(zod_1.z.object({ partidoId: zod_1.z.string(), arbitroIds: zod_1.z.array(zod_1.z.string()) })),
});
//# sourceMappingURL=validator.js.map