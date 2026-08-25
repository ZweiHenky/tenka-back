import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import type { ApiResponse } from '../utils/response';

export function errorHandler(err: Error, req: Request, res: Response, next: NextFunction) {
  if (res.headersSent) {
    next(err);
    return;
  }
  if (err instanceof AppError) {
    const body: ApiResponse = { success: false, error: err.message, requestId: req.requestId };
    if (err.code !== undefined) body.code = err.code;
    if (err.details !== undefined) body.details = err.details;
    res.status(err.statusCode).json(body);
    return;
  }

  const parserError = err as Error & { status?: number; type?: string };
  if (parserError.type === 'entity.too.large' || parserError.status === 413) {
    res.status(413).json({ success: false, error: 'El cuerpo de la solicitud es demasiado grande', requestId: req.requestId });
    return;
  }
  if (parserError.type === 'entity.parse.failed' || (err instanceof SyntaxError && parserError.status === 400)) {
    res.status(400).json({ success: false, error: 'JSON invalido', requestId: req.requestId });
    return;
  }

  req.log?.error({ event: 'request.failed', requestId: req.requestId, err });
  const body: ApiResponse = { success: false, error: 'Error interno del servidor', requestId: req.requestId };
  res.status(500).json(body);
}
