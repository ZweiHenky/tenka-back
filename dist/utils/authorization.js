"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAdmin = isAdmin;
exports.assertRole = assertRole;
exports.assertOwnerOrAdmin = assertOwnerOrAdmin;
const errors_1 = require("./errors");
function isAdmin(actor) {
    return actor.rol === 'ADMINISTRADOR';
}
function assertRole(actor, ...roles) {
    if (!isAdmin(actor) && !roles.includes(actor.rol)) {
        throw new errors_1.ForbiddenError();
    }
}
function assertOwnerOrAdmin(actor, ownerId, resource) {
    if (!isAdmin(actor) && actor.id !== ownerId) {
        throw new errors_1.NotFoundError(resource);
    }
}
//# sourceMappingURL=authorization.js.map