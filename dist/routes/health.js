"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHealthRouter = createHealthRouter;
const express_1 = require("express");
const database_1 = require("../config/database");
const env_1 = require("../config/env");
const readiness_1 = require("../config/readiness");
const defaultDependencies = {
    checkDatabase: () => database_1.prisma.$queryRawUnsafe('SELECT 1'),
    isReady: readiness_1.isReadyForTraffic,
    timeoutMs: env_1.env.READINESS_TIMEOUT_MS,
};
async function withDeadline(operation, timeoutMs) {
    let timeout;
    try {
        await Promise.race([
            operation,
            new Promise((_, reject) => {
                timeout = setTimeout(() => reject(new Error('readiness_timeout')), timeoutMs);
            }),
        ]);
    }
    finally {
        if (timeout)
            clearTimeout(timeout);
    }
}
function createHealthRouter(overrides = {}) {
    const dependencies = { ...defaultDependencies, ...overrides };
    const router = (0, express_1.Router)();
    const live = (_req, res) => res.status(200).json({ status: 'ok' });
    router.get('/live', live);
    router.get('/api/health', live);
    router.get('/ready', async (_req, res) => {
        if (!dependencies.isReady()) {
            res.status(503).json({ status: 'not_ready', reason: 'shutting_down' });
            return;
        }
        try {
            await withDeadline(dependencies.checkDatabase(), dependencies.timeoutMs);
            res.status(200).json({ status: 'ready' });
        }
        catch (error) {
            const reason = error instanceof Error && error.message === 'readiness_timeout' ? 'database_timeout' : 'database_error';
            res.status(503).json({ status: 'not_ready', reason });
        }
    });
    return router;
}
//# sourceMappingURL=health.js.map