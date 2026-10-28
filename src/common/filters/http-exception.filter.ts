// TPRD 01 §6.1 — global error envelope.
//
// Every exception that escapes a handler passes through here and leaves as
//   { error: { code, message, fields?, details? } }
// Mapping (§6.1):
//   AppError        → its own status / code
//   Zod failure     → 400 VALIDATION_ERROR with `fields`
//   HttpException   → its own status; code derived from the class name (NotFoundException → NOT_FOUND)
//   anything else   → 500 INTERNAL, message hidden, stack logged with request id
// The body never contains a stack trace (AC-F5).
//
// Registration (main.ts, §6.5 step 5):
//   app.useGlobalFilters(new HttpExceptionFilter(app.get(Logger)));   // Logger from 'nestjs-pino'
// `Logger` is a singleton so `app.get` works; `PinoLogger` is TRANSIENT and would
// need `await app.resolve(...)`. The class is also `@Injectable()` so it can be
// provided through `APP_FILTER` if that is ever preferred.
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError, ZodIssue } from 'zod';
import { AppError } from '../errors/app-error';

/** Wire shape of every 4xx/5xx response (TPRD 01 §6.1, AC-F5). */
export interface ErrorEnvelope {
  error: {
    code: string;
    message: string;
    fields?: Record<string, string>;
    details?: Record<string, unknown>;
  };
}

export const VALIDATION_ERROR_CODE = 'VALIDATION_ERROR';
export const INTERNAL_ERROR_CODE = 'INTERNAL';
const VALIDATION_ERROR_MESSAGE = 'Validation failed';
const INTERNAL_ERROR_MESSAGE = 'Internal server error';
/** Key used in `fields` for a zod issue with an empty path (e.g. body is not an object). */
const ROOT_FIELD_KEY = '_root';

// Minimal structural views of the Express request/response so this file does
// not depend on `@types/express` (not installed) or on `any`.
interface HttpRequestLike {
  id?: unknown; // set by pino-http (`req.id`)
  method?: string;
  url?: string;
}
interface HttpResponseLike {
  status(code: number): HttpResponseLike;
  json(body: unknown): unknown;
}

@Injectable()
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<HttpRequestLike>();
    const res = http.getResponse<HttpResponseLike>();

    // §6.1 — AppError → its own status/code; fields/details only when present
    if (exception instanceof AppError) {
      res
        .status(exception.status)
        .json(envelope(exception.code, exception.message, exception.fields, exception.details));
      return;
    }

    // §6.1 — Zod failure → 400 VALIDATION_ERROR with `fields` keyed by issue path
    const zodError = extractZodError(exception);
    if (zodError) {
      res
        .status(HttpStatus.BAD_REQUEST)
        .json(
          envelope(VALIDATION_ERROR_CODE, VALIDATION_ERROR_MESSAGE, zodFields(zodError.issues)),
        );
      return;
    }

    // §6.1 — Nest HttpException (404 unknown route, 403 from a guard, …) → its own
    // status; code derived from the class name; framework message is safe to expose.
    // Expected traffic, so logged at warn (error only for 5xx), without a stack.
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const code = httpExceptionCode(exception, status);
      const entry = { requestId: req?.id, method: req?.method, url: req?.url, status, code };
      if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
        this.logger.error({ ...entry, err: exception }, HttpExceptionFilter.name);
      } else {
        this.logger.warn({ ...entry, msg: exception.message }, HttpExceptionFilter.name);
      }
      res.status(status).json(envelope(code, exception.message));
      return;
    }

    // §6.1 — unknown exception → 500 INTERNAL,
    // message hidden from the client, real error + stack logged with request id
    const err = exception instanceof Error ? exception : new Error(String(exception));
    this.logger.error(
      {
        err,
        requestId: req?.id,
        method: req?.method,
        url: req?.url,
        status: HttpStatus.INTERNAL_SERVER_ERROR,
      },
      HttpExceptionFilter.name,
    );
    res
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json(envelope(INTERNAL_ERROR_CODE, INTERNAL_ERROR_MESSAGE));
  }
}

/**
 * Deterministic code for a Nest `HttpException`: the class name minus the
 * `Exception` suffix as UPPER_SNAKE (`NotFoundException` → `NOT_FOUND`,
 * `UnprocessableEntityException` → `UNPROCESSABLE_ENTITY`). A bare
 * `HttpException` has no class-name information, so fall back to the
 * `HttpStatus` enum name for its status, then to `HTTP_ERROR`.
 */
function httpExceptionCode(exception: HttpException, status: number): string {
  const base = exception.constructor.name.replace(/Exception$/, '');
  if (base.length > 0 && base !== 'Http') {
    return base.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
  }
  const fromStatus = HttpStatus[status];
  return typeof fromStatus === 'string' ? fromStatus : 'HTTP_ERROR';
}

/** Build the envelope, omitting `fields` / `details` keys when undefined. */
function envelope(
  code: string,
  message: string,
  fields?: Record<string, string>,
  details?: Record<string, unknown>,
): ErrorEnvelope {
  const body: ErrorEnvelope = { error: { code, message } };
  if (fields !== undefined) body.error.fields = fields;
  if (details !== undefined) body.error.details = details;
  return body;
}

/**
 * Pull the ZodError out of whatever was thrown: nestjs-zod's
 * `ZodValidationException` (from the global `ZodValidationPipe`), a raw
 * `ZodError`, or a ZodError-shaped error from a second zod instance.
 */
function extractZodError(exception: unknown): ZodError | undefined {
  if (exception instanceof ZodValidationException) return exception.getZodError();
  if (exception instanceof ZodError) return exception;
  if (
    exception instanceof Error &&
    exception.name === 'ZodError' &&
    Array.isArray((exception as { issues?: unknown }).issues)
  ) {
    return exception as ZodError;
  }
  return undefined;
}

/** `issue.path.join('.')` → message; first issue per path wins. */
function zodFields(issues: ZodIssue[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const key = issue.path.length > 0 ? issue.path.join('.') : ROOT_FIELD_KEY;
    if (!Object.hasOwn(fields, key)) fields[key] = issue.message;
  }
  return fields;
}
