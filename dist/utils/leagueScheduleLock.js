"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.acquireLeagueScheduleLock = acquireLeagueScheduleLock;
async function acquireLeagueScheduleLock(tx, ligaId) {
    await tx.$executeRawUnsafe('SELECT pg_advisory_xact_lock(hashtext($1))', ligaId);
}
//# sourceMappingURL=leagueScheduleLock.js.map