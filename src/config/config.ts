// TPRD 01 §3 — typed environment loader.
//
// This is the ONLY file in the project that reads `process.env` (CLAUDE.md).
// Every other module receives the parsed `Config` object through DI via
// `ConfigModule` / the `CONFIG` token. `.env` is loaded here because nothing
// else in the project loads it.
import 'dotenv/config';
import { z } from 'zod';

/** Injection token for the parsed configuration object. */
export const CONFIG = Symbol('CONFIG');

const requiredString = (name: string) =>
  z
    .string({ required_error: `${name} is required` })
    .trim()
    .min(1, `${name} is required`);

const requiredUrl = (name: string) => requiredString(name).url(`${name} must be a valid URL`);

const requiredPositiveInt = (name: string) =>
  requiredString(name)
    .regex(/^\d+$/, `${name} must be a positive integer`)
    .transform(Number)
    .pipe(z.number().int().positive(`${name} must be a positive integer`));

// Exactly the twelve variables listed in TPRD 01 §3 (`.env.example`).
export const ConfigSchema = z.object({
  PORT: requiredPositiveInt('PORT').pipe(z.number().max(65535, 'PORT must be <= 65535')),
  DATABASE_URL: requiredUrl('DATABASE_URL'),
  REDIS_URL: requiredUrl('REDIS_URL'),
  // RS256 PEM, base64-encoded single line (decoded by 02-auth).
  JWT_PRIVATE_KEY: requiredString('JWT_PRIVATE_KEY'),
  JWT_PUBLIC_KEY: requiredString('JWT_PUBLIC_KEY'),
  // Duration strings such as `15m` / `7d`; interpreted by 02-auth.
  ACCESS_TOKEN_TTL: requiredString('ACCESS_TOKEN_TTL'),
  REFRESH_TOKEN_TTL: requiredString('REFRESH_TOKEN_TTL'),
  INVITE_TTL_HOURS: requiredPositiveInt('INVITE_TTL_HOURS'),
  FRONTEND_URL: requiredUrl('FRONTEND_URL'),
  // Kept as the raw comma-separated string; main.ts does `CORS_ORIGINS.split(',')` (§6.5 step 2).
  CORS_ORIGINS: requiredString('CORS_ORIGINS'),
  MAIL_PROVIDER: z.enum(['console', 'ses', 'sendgrid'], {
    required_error: 'MAIL_PROVIDER is required',
    invalid_type_error: 'MAIL_PROVIDER must be one of: console, ses, sendgrid',
  }),
  MAIL_FROM: requiredString('MAIL_FROM').email('MAIL_FROM must be a valid email address'),
});

export type Config = z.infer<typeof ConfigSchema>;
export type MailProvider = Config['MAIL_PROVIDER'];

/**
 * Thrown when the environment is missing or invalid. The message names every
 * offending variable so the boot failure is actionable (AC-F1).
 */
export class ConfigError extends Error {
  constructor(
    public readonly variables: string[],
    issues: string[],
  ) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigError';
  }
}

/**
 * Parse and validate an environment dictionary. Pure: no caching, no
 * side effects. Throws `ConfigError` naming each missing/invalid variable.
 */
export function parseConfig(env: Record<string, string | undefined>): Config {
  const result = ConfigSchema.safeParse(env);
  if (result.success) return result.data;

  const seen = new Set<string>();
  const issues: string[] = [];
  for (const issue of result.error.issues) {
    const name = String(issue.path[0] ?? '(root)');
    // Custom messages already start with the variable name; prefix zod's built-in ones.
    const line = issue.message.startsWith(name) ? issue.message : `${name}: ${issue.message}`;
    if (!seen.has(line)) {
      seen.add(line);
      issues.push(line);
    }
  }
  const variables = [...new Set(result.error.issues.map((i) => String(i.path[0])))];
  throw new ConfigError(variables, issues);
}

let cached: Config | undefined;

/**
 * Parse `process.env` once and reuse the result for the lifetime of the
 * process. Called first by `main.ts` (§6.5 step 1) and by `ConfigModule`.
 * Throws `ConfigError` on the first call if the environment is invalid,
 * which crashes boot with a message naming the variable (AC-F1).
 */
export function loadConfig(): Config {
  if (!cached) cached = parseConfig(process.env);
  return cached;
}
