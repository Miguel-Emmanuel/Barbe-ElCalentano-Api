import type { NextFunction, Request, Response } from "express";
import { AppError, toErrorPayload } from "../lib/errors.js";

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  const payload = toErrorPayload(err);
  const status = err instanceof AppError ? err.status : 500;
  res.status(status).json(payload);
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}
