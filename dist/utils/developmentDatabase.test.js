"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const developmentDatabase_1 = require("./developmentDatabase");
const originalAuth = process.env.DEVELOPMENT_SCRIPT_AUTH;
(0, vitest_1.describe)('createDevelopmentPrismaClient', () => {
    (0, vitest_1.afterEach)(() => {
        if (originalAuth === undefined)
            delete process.env.DEVELOPMENT_SCRIPT_AUTH;
        else
            process.env.DEVELOPMENT_SCRIPT_AUTH = originalAuth;
    });
    (0, vitest_1.it)('blocks direct execution before creating a database client', () => {
        delete process.env.DEVELOPMENT_SCRIPT_AUTH;
        (0, vitest_1.expect)(() => (0, developmentDatabase_1.createDevelopmentPrismaClient)()).toThrow('Direct database script execution is disabled');
    });
    (0, vitest_1.it)('rejects an invalid script authorization', () => {
        process.env.DEVELOPMENT_SCRIPT_AUTH = 'invalid';
        (0, vitest_1.expect)(() => (0, developmentDatabase_1.createDevelopmentPrismaClient)()).toThrow('Direct database script execution is disabled');
    });
});
//# sourceMappingURL=developmentDatabase.test.js.map