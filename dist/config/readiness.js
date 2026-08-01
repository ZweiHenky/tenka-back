"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isReadyForTraffic = isReadyForTraffic;
exports.markNotReady = markNotReady;
exports.resetReadinessForTests = resetReadinessForTests;
let acceptingTraffic = true;
function isReadyForTraffic() {
    return acceptingTraffic;
}
function markNotReady() {
    acceptingTraffic = false;
}
function resetReadinessForTests() {
    acceptingTraffic = true;
}
//# sourceMappingURL=readiness.js.map