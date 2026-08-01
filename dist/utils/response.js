"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ok = ok;
exports.created = created;
exports.noContent = noContent;
function ok(res, data, message) {
    const body = { success: true, data };
    if (message)
        body.message = message;
    res.status(200).json(body);
}
function created(res, data, message) {
    const body = { success: true, data };
    if (message)
        body.message = message;
    res.status(201).json(body);
}
function noContent(res) {
    res.status(204).end();
}
//# sourceMappingURL=response.js.map