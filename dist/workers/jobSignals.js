"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerJobSignal = registerJobSignal;
exports.signalBackgroundJob = signalBackgroundJob;
const listeners = new Map();
function registerJobSignal(job, signal) {
    listeners.set(job, signal);
    return () => {
        if (listeners.get(job) === signal)
            listeners.delete(job);
    };
}
function signalBackgroundJob(job, dueAt) {
    listeners.get(job)?.(dueAt);
}
//# sourceMappingURL=jobSignals.js.map