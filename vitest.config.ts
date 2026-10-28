import 'dotenv/config';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

// e2e tests build the real Nest app (nest-prisma-patterns: createTestApp) and
// must run against DATABASE_URL_TEST, never the dev database (CLAUDE.md).
const DATABASE_URL_TEST =
  process.env.DATABASE_URL_TEST ?? 'postgresql://hrms:hrms@localhost:5432/hrms_test';

export default defineConfig({
  plugins: [
    // esbuild cannot emit decorator metadata, which Nest DI relies on.
    // `module: { type: 'es6' }` (not 'commonjs'): swc still emits the
    // `Reflect.decorate`/`design:paramtypes` calls Nest DI needs regardless
    // of output module format, but emitting literal `require()` calls here
    // breaks Vitest's own `import ... from 'vitest'` (it throws "Vitest
    // cannot be imported in a CommonJS module using require()" — vitest's
    // CJS entry point is a stub that only guards against bundlers), in every
    // file Vite transforms, including setupFiles.
    swc.vite({ module: { type: 'es6' } }),
  ],
  test: {
    root: './',
    include: ['test/**/*.e2e.spec.ts'],
    setupFiles: ['./test/setup.ts'],
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: DATABASE_URL_TEST,
      DATABASE_URL_TEST,
    },
    // One shared test database: run files sequentially so resets do not race.
    fileParallelism: false,
    pool: 'forks',
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
