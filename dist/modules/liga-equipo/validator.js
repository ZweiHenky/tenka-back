"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateSchema = exports.createSchema = void 0;
const zod_1 = require("zod");
exports.createSchema = zod_1.z.object({
    ligaId: zod_1.z.string().min(1),
    equipoId: zod_1.z.string().min(1),
});
exports.updateSchema = zod_1.z.object({}).passthrough();
//# sourceMappingURL=validator.js.map