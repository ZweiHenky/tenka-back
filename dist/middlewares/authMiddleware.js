"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAuth = requireAuth;
exports.optionalAuth = optionalAuth;
exports.requireRole = requireRole;
const auth_1 = require("../auth");
const errors_1 = require("../utils/errors");
const auth_2 = require("../types/auth");
async function requireAuth(req, _res, next) {
    try {
        const session = await auth_1.auth.api.getSession({ headers: req.headers });
        if (!session?.user)
            throw new errors_1.UnauthorizedError();
        const role = session.user.rol;
        if (typeof role !== 'string' || !auth_2.USER_ROLES.includes(role)) {
            throw new errors_1.UnauthorizedError('La cuenta no tiene un rol válido');
        }
        req.user = { ...session.user, rol: role };
        next();
    }
    catch (e) {
        next(e);
    }
}
async function optionalAuth(req, _res, next) {
    try {
        const session = await auth_1.auth.api.getSession({ headers: req.headers });
        const role = session?.user?.rol;
        if (session?.user && typeof role === 'string' && auth_2.USER_ROLES.includes(role)) {
            req.user = { ...session.user, rol: role };
        }
    }
    catch {
        // Public requests remain anonymous when a cookie or session is invalid.
    }
    next();
}
function requireRole(...roles) {
    return (req, _res, next) => {
        if (!req.user) {
            next(new errors_1.UnauthorizedError());
            return;
        }
        if (req.user.rol !== 'ADMINISTRADOR' && !roles.includes(req.user.rol)) {
            next(new errors_1.ForbiddenError());
            return;
        }
        next();
    };
}
//# sourceMappingURL=authMiddleware.js.map