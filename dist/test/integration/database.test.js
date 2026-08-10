"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const variableNames = [
    'TEST_DATABASE_URL', 'DEV_DATABASE_URL', 'DEV_DIRECT_DATABASE_URL',
    'DATABASE_URL', 'DIRECT_DATABASE_URL',
];
const originalValues = new Map(variableNames.map((name) => [name, process.env[name]]));
async function loadDatabaseGuard() {
    vitest_1.vi.resetModules();
    return Promise.resolve().then(() => __importStar(require('./database')));
}
(0, vitest_1.describe)('integration database guard', () => {
    (0, vitest_1.beforeEach)(() => {
        for (const name of variableNames)
            delete process.env[name];
        process.env.DEV_DATABASE_URL = 'postgresql://user:secret@ep-development-pooler.example.com/app';
        process.env.DEV_DIRECT_DATABASE_URL = 'postgresql://user:secret@ep-development.example.com/app';
    });
    (0, vitest_1.afterEach)(() => {
        for (const name of variableNames) {
            const original = originalValues.get(name);
            if (original === undefined)
                delete process.env[name];
            else
                process.env[name] = original;
        }
    });
    (0, vitest_1.it)('allows the development database only through the isolated integration schema', async () => {
        process.env.TEST_DATABASE_URL = 'postgresql://user:secret@ep-development.example.com/app?schema=myleague_integration';
        const { getIntegrationDatabaseUrl } = await loadDatabaseGuard();
        (0, vitest_1.expect)(new URL(getIntegrationDatabaseUrl()).searchParams.get('schema')).toBe('myleague_integration');
    });
    (0, vitest_1.it)('rejects pooled URLs and non-integration schemas', async () => {
        process.env.TEST_DATABASE_URL = 'postgresql://user:secret@ep-test-pooler.example.com/app?schema=myleague_integration';
        let guard = await loadDatabaseGuard();
        (0, vitest_1.expect)(() => guard.getIntegrationDatabaseUrl()).toThrow('direct connection');
        process.env.TEST_DATABASE_URL = 'postgresql://user:secret@ep-test.example.com/app?schema=public';
        guard = await loadDatabaseGuard();
        (0, vitest_1.expect)(() => guard.getIntegrationDatabaseUrl()).toThrow('schema must be myleague_integration');
    });
    (0, vitest_1.it)('recognizes pooled and direct production URLs as the same forbidden database', async () => {
        process.env.DATABASE_URL = 'postgresql://runtime:secret@ep-production-pooler.example.com/app';
        process.env.TEST_DATABASE_URL = 'postgresql://test:secret@ep-production.example.com/app?schema=myleague_integration';
        const { getIntegrationDatabaseUrl } = await loadDatabaseGuard();
        (0, vitest_1.expect)(() => getIntegrationDatabaseUrl()).toThrow('must not target the same database as DATABASE_URL');
    });
});
//# sourceMappingURL=database.test.js.map