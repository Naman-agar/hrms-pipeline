// TPRD 01 §6.5 — application bootstrap.
//
// The seven numbered steps of §6.5 are implemented below in that order. Each
// step is a distinct block so the reviewer can check coverage against the TPRD.
//
// Config failure (AC-F1): `loadConfig()` throws `ConfigError` whose message
// names every missing/invalid variable. `bootstrap()` is wrapped so that a
// `ConfigError` — whether thrown by step 1 here or later by `ConfigModule`'s
// `CONFIG` factory during `NestFactory.create` — is printed as a single clean
// message and the process exits with code 1, instead of a Nest stack trace.
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ConfigError, loadConfig } from './config/config';

const GLOBAL_PREFIX = 'api/v1';
const SWAGGER_PATH = 'api/docs';

async function bootstrap(): Promise<void> {
  // §6.5 step 1 — load config (throws ConfigError naming each missing env var; AC-F1).
  // `loadConfig()` is memoised, so `ConfigModule` reuses this same parsed object.
  const config = loadConfig();

  // `bufferLogs` holds Nest's own boot logs until `useLogger` routes them through pino.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  // nestjs-pino's `Logger` is a singleton, so `app.get` (not `resolve`) is correct here.
  const logger = app.get(Logger);
  app.useLogger(logger);

  // §6.5 step 2 — CORS: comma-separated CORS_ORIGINS, credentials allowed
  app.enableCors({ origin: config.CORS_ORIGINS.split(','), credentials: true });

  // §6.5 step 3 — helmet security headers
  app.use(helmet());

  // §6.5 step 4 — global prefix: every controller route lives under /api/v1
  app.setGlobalPrefix(GLOBAL_PREFIX);

  // §6.5 step 5 — global Zod validation pipe + global error-envelope filter (§6.1)
  app.useGlobalPipes(new ZodValidationPipe());
  app.useGlobalFilters(new HttpExceptionFilter(logger));

  // §6.5 step 6 — Swagger at /api/docs (not under the api/v1 prefix)
  const swaggerConfig = new DocumentBuilder()
    .setTitle('HRMS API')
    .setDescription('Backend for the HRMS User-management screen')
    .setVersion('1.0')
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup(SWAGGER_PATH, app, document);

  // §6.5 step 7 — listen on PORT
  await app.listen(config.PORT);
  logger.log(
    `HRMS API listening on port ${config.PORT} (prefix /${GLOBAL_PREFIX}, docs /${SWAGGER_PATH})`,
  );
}

bootstrap().catch((err: unknown) => {
  // AC-F1 — missing/invalid env var: print the message naming the variable(s) and exit non-zero.
  if (err instanceof ConfigError) {
    console.error(err.message);
    process.exit(1);
  }
  // Any other boot failure (DB unreachable, port in use, …): surface it and exit non-zero
  // so a supervisor restarts the process rather than leaving it half-started.
  console.error(err);
  process.exit(1);
});
