"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = errorHandler;
const errors_1 = require("../utils/errors");
function errorHandler(err, req, res, next) {
    if (res.headersSent) {
        next(err);
        return;
    }
    if (err instanceof errors_1.AppError) {
        const body = { success: false, error: err.message, requestId: req.requestId };
        res.status(err.statusCode).json(body);
        return;
    }
    const parserError = err;
    if (parserError.type === 'entity.too.large' || parserError.status === 413) {
        res.status(413).json({ success: false, error: 'El cuerpo de la solicitud es demasiado grande', requestId: req.requestId });
        return;
    }
    if (parserError.type === 'entity.parse.failed' || (err instanceof SyntaxError && parserError.status === 400)) {
        res.status(400).json({ success: false, error: 'JSON invalido', requestId: req.requestId });
        return;
    }
    req.log?.error({ event: 'request.failed', requestId: req.requestId, err });
    const body = { success: false, error: 'Error interno del servidor', requestId: req.requestId };
    res.status(500).json(body);
}
//# sourceMappingURL=errorHandler.js.map