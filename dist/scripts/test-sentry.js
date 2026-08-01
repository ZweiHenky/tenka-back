"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require("../instrument");
const instrument_1 = require("../instrument");
const logger_1 = require("../config/logger");
async function main() {
    instrument_1.Sentry.captureMessage('Tenka backend Sentry test', 'info');
    const sent = await instrument_1.Sentry.flush(5000);
    logger_1.logger.info({ event: 'sentry.test.completed', sent });
    process.exit(sent ? 0 : 1);
}
void main();
//# sourceMappingURL=test-sentry.js.map