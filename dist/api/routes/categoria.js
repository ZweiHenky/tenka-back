"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.categoriaRouter = void 0;
const express_1 = require("express");
const categoria_1 = require("../controllers/categoria");
const router = (0, express_1.Router)();
exports.categoriaRouter = router;
router.get('/', categoria_1.categoriaController.list);
router.get('/:id', categoria_1.categoriaController.getById);
router.post('/', categoria_1.categoriaController.create);
router.patch('/:id', categoria_1.categoriaController.update);
router.delete('/:id', categoria_1.categoriaController.delete);
//# sourceMappingURL=categoria.js.map