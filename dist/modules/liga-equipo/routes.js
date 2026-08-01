"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ligaEquipoRouter = void 0;
const express_1 = require("express");
const controller_1 = require("./controller");
const router = (0, express_1.Router)();
exports.ligaEquipoRouter = router;
router.get('/liga/:ligaId', controller_1.ligaEquipoController.findByLiga);
router.get('/equipo/:equipoId', controller_1.ligaEquipoController.findByEquipo);
router.post('/', controller_1.ligaEquipoController.create);
router.delete('/:ligaId/:equipoId', controller_1.ligaEquipoController.delete);
//# sourceMappingURL=routes.js.map