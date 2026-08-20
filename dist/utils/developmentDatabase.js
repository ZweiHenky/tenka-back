"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDevelopmentPrismaClient = createDevelopmentPrismaClient;
const adapter_pg_1 = require("@prisma/adapter-pg");
const env_1 = require("../config/env");
const client_1 = require("../generated/prisma/client");
const DEVELOPMENT_SCRIPT_AUTH = 'tenka-development-script-v1';
function createDevelopmentPrismaClient() {
    if (process.env.DEVELOPMENT_SCRIPT_AUTH !== DEVELOPMENT_SCRIPT_AUTH) {
        throw new Error('Direct database script execution is disabled. Use a pnpm db:script:* command.');
    }
    if (env_1.env.APP_ENV !== 'local' || env_1.env.DB_TARGET !== 'development') {
        throw new Error('Database scripts are only allowed for the development target.');
    }
    return new client_1.PrismaClient({
        adapter: new adapter_pg_1.PrismaPg({ connectionString: env_1.env.DATABASE_URL }),
    });
}
//# sourceMappingURL=developmentDatabase.js.map