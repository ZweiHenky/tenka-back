import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import express, { type NextFunction, type Request, type Response } from 'express';
import { env, type BackendEnv } from '../../config/env';
import { logger } from '../../config/logger';
import { revenueCatWebhookLimiter } from '../../middlewares/rateLimits';
import { signalBackgroundJob } from '../../workers/jobSignals';
import { ingestRevenueCatWebhook, parseRevenueCatWebhook } from './webhookInbox';

const WEBHOOK_SIGNATURE_TOLERANCE_MS = 5 * 60_000;

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function authorized(header: string | undefined, secrets: ReadonlyArray<string | undefined>): boolean {
  const match = /^Bearer ([^\s]+)$/.exec(header ?? '');
  if (!match) return false;
  const candidate = digest(match[1]);
  return secrets.some((secret) => secret !== undefined && timingSafeEqual(candidate, digest(secret)));
}

function authorizationDiagnostics(
  header: string | undefined,
) {
  const match = /^Bearer ([^\s]+)$/.exec(header ?? '');
  return {
    headerPresent: header !== undefined,
    bearerFormatValid: match !== null,
  };
}

interface RevenueCatWebhookSignature {
  timestamp: number;
  signature: Buffer;
}

function parseWebhookSignature(header: string | undefined): RevenueCatWebhookSignature | null {
  if (!header) return null;
  const parts = header.split(',');
  if (parts.length !== 2) return null;
  const values = new Map<string, string>();
  for (const part of parts) {
    const match = /^([a-z0-9]+)=([^,=]+)$/.exec(part.trim());
    if (!match || values.has(match[1])) return null;
    values.set(match[1], match[2]);
  }
  if (values.size !== 2 || !values.has('t') || !values.has('v1')) return null;
  const timestampValue = values.get('t')!;
  const signatureValue = values.get('v1')!;
  if (!/^[1-9]\d*$/.test(timestampValue) || !/^[0-9a-f]{64}$/.test(signatureValue)) return null;
  const timestamp = Number(timestampValue);
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0) return null;
  return { timestamp, signature: Buffer.from(signatureValue, 'hex') };
}

function validWebhookSignature(
  body: Buffer,
  header: string | undefined,
  secret: string,
  nowMs = Date.now(),
): boolean {
  const parsed = parseWebhookSignature(header);
  if (!parsed) return false;
  const timestampMs = parsed.timestamp * 1000;
  if (Math.abs(nowMs - timestampMs) > WEBHOOK_SIGNATURE_TOLERANCE_MS) return false;
  const expected = createHmac('sha256', secret)
    .update(`${parsed.timestamp}.`)
    .update(body)
    .digest();
  return timingSafeEqual(parsed.signature, expected);
}

export function createRevenueCatWebhookAuthorization(configuration: BackendEnv = env) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!configuration.BILLING_REVENUECAT_ENABLED || !configuration.REVENUECAT_WEBHOOK_SECRET) {
      res.status(503).json({ success: false, error: 'Webhook no disponible', requestId: req.requestId });
      return;
    }
    if (!authorized(req.get('authorization'), [
      configuration.REVENUECAT_WEBHOOK_SECRET,
      configuration.REVENUECAT_WEBHOOK_PREVIOUS_SECRET,
    ])) {
      logger.warn({
        event: 'billing.webhook_authorization_failed',
        ...authorizationDiagnostics(req.get('authorization')),
      }, 'RevenueCat webhook authorization failed');
      res.status(401).json({ success: false, error: 'No autorizado', requestId: req.requestId });
      return;
    }
    next();
  };
}

export function createRevenueCatWebhookSignatureVerification(
  configuration: BackendEnv = env,
  now: () => number = Date.now,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const configuredMode = configuration.REVENUECAT_WEBHOOK_SIGNATURE_MODE;
    if (configuredMode === 'disabled') {
      next();
      return;
    }
    const secret = configuration.REVENUECAT_WEBHOOK_SIGNING_SECRET;
    if (!secret) {
      res.status(503).json({ success: false, error: 'Webhook no disponible', requestId: req.requestId });
      return;
    }
    const nowMs = now();
    const observeUntil = configuration.REVENUECAT_WEBHOOK_SIGNATURE_OBSERVE_UNTIL
      ? Date.parse(configuration.REVENUECAT_WEBHOOK_SIGNATURE_OBSERVE_UNTIL)
      : Number.NaN;
    const mode = configuredMode === 'observe' && nowMs <= observeUntil ? 'observe' : 'enforce';
    const header = req.get('x-revenuecat-webhook-signature');
    const valid = Buffer.isBuffer(req.body)
      && validWebhookSignature(req.body, header, secret, nowMs);
    if (!valid) {
      const parsed = parseWebhookSignature(header);
      logger.warn({
        event: 'billing.webhook_signature_failed',
        mode,
        headerPresent: header !== undefined,
        formatValid: parsed !== null,
        timestampAgeMs: parsed ? Math.abs(nowMs - parsed.timestamp * 1000) : null,
      }, 'RevenueCat webhook signature verification failed');
      if (mode === 'enforce') {
        res.status(401).json({ success: false, error: 'No autorizado', requestId: req.requestId });
        return;
      }
    }
    next();
  };
}

function requireIdentityContentEncoding(req: Request, res: Response, next: NextFunction): void {
  const encoding = req.get('content-encoding');
  if (encoding && encoding.toLowerCase() !== 'identity') {
    res.status(415).json({
      success: false,
      error: 'La codificacion del cuerpo no es compatible',
      requestId: req.requestId,
    });
    return;
  }
  next();
}

export function createRevenueCatWebhookRouter(dependencies: {
  configuration?: BackendEnv;
  limiter?: express.RequestHandler;
  ingest?: typeof ingestRevenueCatWebhook;
} = {}) {
  const configuration = dependencies.configuration ?? env;
  const limiter = dependencies.limiter ?? revenueCatWebhookLimiter;
  const ingest = dependencies.ingest ?? ingestRevenueCatWebhook;
  const router = express.Router();
  router.post(
    '/',
    limiter,
    createRevenueCatWebhookAuthorization(configuration),
    requireIdentityContentEncoding,
    express.raw({
      type: 'application/json',
      limit: configuration.REVENUECAT_WEBHOOK_BODY_LIMIT,
      inflate: false,
    }),
    createRevenueCatWebhookSignatureVerification(configuration),
    async (req, res) => {
      if (!Buffer.isBuffer(req.body)) {
        res.status(400).json({ success: false, error: 'JSON invalido', requestId: req.requestId });
        return;
      }
      let input: ReturnType<typeof parseRevenueCatWebhook>;
      try {
        input = parseRevenueCatWebhook(req.body);
      } catch {
        res.status(400).json({ success: false, error: 'Evento de webhook invalido', requestId: req.requestId });
        return;
      }
      try {
        const status = await ingest(input);
        if (status === 'ACCEPTED') signalBackgroundJob('billing-webhook');
        res.status(200).json({ success: true, data: { status } });
      } catch {
        res.status(503).json({ success: false, error: 'Webhook temporalmente no disponible', requestId: req.requestId });
      }
    },
  );
  return router;
}

export const revenueCatWebhookRouter = createRevenueCatWebhookRouter();
export const webhookRouteInternals = {
  WEBHOOK_SIGNATURE_TOLERANCE_MS,
  authorized,
  authorizationDiagnostics,
  digest,
  parseWebhookSignature,
  validWebhookSignature,
};
