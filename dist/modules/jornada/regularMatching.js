"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeMinimumHistoryMatching = computeMinimumHistoryMatching;
const edmonds_blossom_1 = __importDefault(require("edmonds-blossom"));
function computeMinimumHistoryMatching({ teams, fixedTeamIds, matchCount }) {
    if (teams.length === 0)
        return new Map();
    const sorted = [...teams].sort((a, b) => a.id.localeCompare(b.id));
    let maxHistory = 0;
    for (let i = 0; i < sorted.length; i += 1) {
        for (let j = i + 1; j < sorted.length; j += 1) {
            maxHistory = Math.max(maxHistory, matchCount(sorted[i].id, sorted[j].id));
        }
    }
    const edgeCount = sorted.length * sorted.length;
    const historyWeight = sorted.length ** 3 + 1;
    const edges = [];
    for (let i = 0; i < sorted.length; i += 1) {
        for (let j = i + 1; j < sorted.length; j += 1) {
            if (fixedTeamIds.has(sorted[i].id) && fixedTeamIds.has(sorted[j].id))
                continue;
            const deterministicTieBreak = edgeCount - (i * sorted.length + j);
            const weight = (maxHistory - matchCount(sorted[i].id, sorted[j].id) + 1) * historyWeight + deterministicTieBreak;
            edges.push([i, j, weight]);
        }
    }
    const result = (0, edmonds_blossom_1.default)(edges, true);
    const matching = new Map();
    for (let i = 0; i < sorted.length; i += 1) {
        const partner = result[i];
        if (partner == null || partner < 0)
            continue;
        matching.set(sorted[i].id, sorted[partner].id);
    }
    return matching;
}
//# sourceMappingURL=regularMatching.js.map