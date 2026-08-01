import '../instrument';
import { Sentry } from '../instrument';
import { logger } from '../config/logger';

async function main() {
  Sentry.captureMessage('Tenka backend Sentry test', 'info');
  const sent = await Sentry.flush(5_000);
  logger.info({ event: 'sentry.test.completed', sent });
  process.exit(sent ? 0 : 1);
}

void main();
