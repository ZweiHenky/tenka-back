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
vitest_1.vi.mock('../../config/database', async () => (await Promise.resolve().then(() => __importStar(require('./service.test-mocks')))).databaseModuleMock);
vitest_1.vi.mock('./repository', async () => (await Promise.resolve().then(() => __importStar(require('./service.test-mocks')))).repositoryModuleMock);
vitest_1.vi.mock('../tabla-posicion/service', async () => (await Promise.resolve().then(() => __importStar(require('./service.test-mocks')))).tablaPosicionModuleMock);
vitest_1.vi.mock('../ronda-playoff/service', async () => (await Promise.resolve().then(() => __importStar(require('./service.test-mocks')))).rondaPlayoffModuleMock);
const service_test_harness_1 = require("./service.test-harness");
(0, vitest_1.describe)('findDeterministicMatching', () => {
    (0, vitest_1.it)('finds the complete matching with the lowest aggregate frequency', () => {
        const occurrences = new Map([
            ['a|b', 0], ['c|d', 10],
            ['a|c', 1], ['b|d', 1],
            ['a|d', 3], ['b|c', 3],
        ]);
        (0, vitest_1.expect)((0, service_test_harness_1.findDeterministicMatching)(['d', 'b', 'a', 'c'], occurrences)).toEqual([
            ['a', 'c'], ['b', 'd'],
        ]);
    });
    (0, vitest_1.it)('uses a deterministic lexical tie-break', () => {
        (0, vitest_1.expect)((0, service_test_harness_1.findDeterministicMatching)(['d', 'b', 'a', 'c'], new Map())).toEqual([
            ['a', 'b'], ['c', 'd'],
        ]);
    });
    (0, vitest_1.it)('allows repeats when every pairing has occurred', () => {
        (0, vitest_1.expect)((0, service_test_harness_1.findDeterministicMatching)(['a', 'b'], new Map([['a|b', 4]]))).toEqual([['a', 'b']]);
    });
    (0, vitest_1.it)('returns null for malformed participant sets', () => {
        (0, vitest_1.expect)((0, service_test_harness_1.findDeterministicMatching)(['a', 'a'], new Map())).toBeNull();
        (0, vitest_1.expect)((0, service_test_harness_1.findDeterministicMatching)(['a'], new Map())).toBeNull();
    });
    (0, vitest_1.it)('returns a deterministic perfect matching for 32 teams', () => {
        const teams = Array.from({ length: 32 }, (_, index) => `team-${String(index + 1).padStart(2, '0')}`);
        const occurrences = new Map();
        for (let i = 0; i < teams.length; i++) {
            for (let j = i + 1; j < teams.length; j++) {
                occurrences.set(`${teams[i]}|${teams[j]}`, (i * 7 + j * 11) % 5);
            }
        }
        const first = (0, service_test_harness_1.findDeterministicMatching)([...teams].reverse(), occurrences);
        const second = (0, service_test_harness_1.findDeterministicMatching)([...teams.slice(16), ...teams.slice(0, 16)], occurrences);
        (0, vitest_1.expect)(first).toEqual(second);
        (0, vitest_1.expect)(first).toHaveLength(16);
        (0, vitest_1.expect)(new Set(first.flat())).toEqual(new Set(teams));
    });
});
//# sourceMappingURL=service.matching.test.js.map