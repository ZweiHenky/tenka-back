"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTeamCode = getTeamCode;
function getTeamCode(teamId) {
    return teamId.replace(/[^a-z0-9]/gi, '').slice(-4).padStart(4, '0').toUpperCase();
}
//# sourceMappingURL=teamCode.js.map