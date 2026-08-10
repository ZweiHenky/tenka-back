"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runInTransaction = runInTransaction;
const database_1 = require("../config/database");
function runInTransaction(callback) {
    if (typeof database_1.prisma.$transaction === 'function')
        return database_1.prisma.$transaction(callback);
    // Repository unit tests use a lightweight Prisma mock without $transaction.
    return callback(database_1.prisma);
}
//# sourceMappingURL=transaction.js.map