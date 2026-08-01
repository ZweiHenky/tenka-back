"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateTipoSchema = exports.createTipoSchema = void 0;
const zod_1 = require("zod");
exports.createTipoSchema = zod_1.z.object({ nombre: zod_1.z.string().min(1) });
exports.updateTipoSchema = zod_1.z.object({ nombre: zod_1.z.string().min(1).optional() });
//# sourceMappingURL=validator.js.map