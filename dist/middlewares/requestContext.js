"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requestContext = requestContext;
const node_crypto_1 = require("node:crypto");
const VALID_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;
function requestContext(req, res, next) {
    const incoming = req.header('x-request-id');
    req.requestId = incoming && VALID_REQUEST_ID.test(incoming) ? incoming : (0, node_crypto_1.randomUUID)();
    res.setHeader('x-request-id', req.requestId);
    next();
}
//# sourceMappingURL=requestContext.js.map