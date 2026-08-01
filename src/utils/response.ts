import { Response } from 'express';

export interface ApiResponse<T = undefined> {
  success: boolean;
  data?: T;
  message?: string;
  error?: string;
  requestId?: string;
}

export function ok<T>(res: Response, data: T, message?: string) {
  const body: ApiResponse<T> = { success: true, data };
  if (message) body.message = message;
  res.status(200).json(body);
}

export function created<T>(res: Response, data: T, message?: string) {
  const body: ApiResponse<T> = { success: true, data };
  if (message) body.message = message;
  res.status(201).json(body);
}

export function noContent(res: Response) {
  res.status(204).end();
}
