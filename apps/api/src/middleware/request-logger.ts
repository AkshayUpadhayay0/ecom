import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RequestHandler } from 'express';
import type { Logger } from 'pino';
import { pinoHttp } from 'pino-http';

export const REQUEST_ID_HEADER = 'x-request-id';

// Accept a caller-supplied id (e.g. from a load balancer) only if it is short and safe to log.
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

function resolveRequestId(req: IncomingMessage, res: ServerResponse): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  const id =
    typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

/**
 * Assigns `req.id` (echoed in the `X-Request-Id` response header), attaches a child logger
 * as `req.log`, and logs one line per completed request.
 */
export function requestLogger(logger: Logger): RequestHandler {
  return pinoHttp({
    logger,
    genReqId: resolveRequestId,
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    serializers: {
      req: (req: { id: unknown; method: unknown; url: unknown }) => ({
        id: req.id,
        method: req.method,
        url: req.url,
      }),
    },
  });
}
