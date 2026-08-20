"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INTEGRATION_SCHEMA = void 0;
exports.getIntegrationDatabaseUrl = getIntegrationDatabaseUrl;
exports.getIntegrationPgConnectionString = getIntegrationPgConnectionString;
const dotenv_1 = require("dotenv");
const node_path_1 = require("node:path");
exports.INTEGRATION_SCHEMA = 'tenka_integration';
let cachedUrl;
function databaseIdentity(url) {
    const hostname = url.hostname.toLowerCase().replace('-pooler.', '.');
    return `${hostname}:${url.port || '5432'}${url.pathname}`;
}
function getIntegrationDatabaseUrl() {
    if (cachedUrl)
        return cachedUrl;
    (0, dotenv_1.config)({ path: (0, node_path_1.resolve)(process.cwd(), '.env'), override: false, quiet: true });
    const testDatabaseUrl = process.env.TEST_DATABASE_URL;
    if (!testDatabaseUrl) {
        throw new Error('TEST_DATABASE_URL is required for integration tests');
    }
    let parsed;
    try {
        parsed = new URL(testDatabaseUrl);
    }
    catch {
        throw new Error('TEST_DATABASE_URL must be a valid URL');
    }
    if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
        throw new Error('TEST_DATABASE_URL must be a PostgreSQL URL');
    }
    if (parsed.hostname.toLowerCase().includes('-pooler.')) {
        throw new Error('TEST_DATABASE_URL must use a direct connection, not a pooled Neon endpoint');
    }
    const applicationTargets = [
        ['DATABASE_URL', process.env.DATABASE_URL],
        ['DIRECT_DATABASE_URL', process.env.DIRECT_DATABASE_URL],
    ];
    for (const [name, value] of applicationTargets) {
        if (!value)
            continue;
        let applicationUrl;
        try {
            applicationUrl = new URL(value);
        }
        catch {
            throw new Error(`${name} must be valid so integration-test safety can be verified`);
        }
        if (!['postgres:', 'postgresql:'].includes(applicationUrl.protocol)) {
            throw new Error(`${name} must be a PostgreSQL URL so integration-test safety can be verified`);
        }
        if (databaseIdentity(parsed) === databaseIdentity(applicationUrl)) {
            throw new Error(`TEST_DATABASE_URL must not target the same database as ${name}`);
        }
    }
    const configuredSchemas = parsed.searchParams.getAll('schema');
    if (configuredSchemas.length > 1) {
        throw new Error('TEST_DATABASE_URL must specify at most one schema');
    }
    if (configuredSchemas[0] && configuredSchemas[0] !== exports.INTEGRATION_SCHEMA) {
        throw new Error(`TEST_DATABASE_URL schema must be ${exports.INTEGRATION_SCHEMA}`);
    }
    if (parsed.searchParams.has('search_path') || /search_path/i.test(parsed.searchParams.get('options') ?? '')) {
        throw new Error('TEST_DATABASE_URL must not override search_path');
    }
    parsed.searchParams.set('schema', exports.INTEGRATION_SCHEMA);
    if (parsed.searchParams.get('schema') !== exports.INTEGRATION_SCHEMA) {
        throw new Error(`Integration database URL must target ${exports.INTEGRATION_SCHEMA}`);
    }
    cachedUrl = parsed.href;
    return cachedUrl;
}
function getIntegrationPgConnectionString() {
    const parsed = new URL(getIntegrationDatabaseUrl());
    parsed.searchParams.delete('schema');
    return parsed.href;
}
//# sourceMappingURL=database.js.map