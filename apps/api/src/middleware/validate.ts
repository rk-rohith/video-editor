import type { NextFunction, Request, Response } from "express";
import type { ZodTypeAny, z } from "zod";

/** Validates req.body against `schema`, replacing it with the parsed (typed, defaulted) value. */
export function validateBody<S extends ZodTypeAny>(schema: S) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({ error: "Validation failed", details: result.error.flatten() });
      return;
    }
    req.body = result.data as z.infer<S>;
    next();
  };
}
