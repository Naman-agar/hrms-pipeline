// TPRD 01 §6.4 — Mail module: BullMQ queue `mail` + worker + provider adapter.
//
// Redis connection comes from `config.REDIS_URL` through the `CONFIG` token
// (nothing here reads `process.env`). The provider adapter is chosen once at
// boot from `config.MAIL_PROVIDER`; only `console` is implemented in TPRD 01.
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { Config, CONFIG } from '../config/config';
import { ConfigModule } from '../config/config.module';
import { MailProcessor } from './mail.processor';
import { MailService } from './mail.service';
import { MAIL_QUEUE } from './mail.types';
import { ConsoleMailProvider } from './providers/console.provider';
import { MAIL_PROVIDER, MailProvider } from './providers/mail-provider.interface';
import { UnsupportedMailProvider } from './providers/unsupported.provider';

@Module({
  imports: [
    ConfigModule,
    // §6.4 — one shared Redis connection for every queue/worker, built from config
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [CONFIG],
      useFactory: (config: Config) => ({
        // BullMQ workers use blocking commands and require maxRetriesPerRequest: null.
        connection: { url: config.REDIS_URL, maxRetriesPerRequest: null },
      }),
    }),
    // §6.4 — the `mail` queue (job options live on each job, see mail.service.ts)
    BullModule.registerQueue({ name: MAIL_QUEUE }),
  ],
  providers: [
    MailService,
    MailProcessor,
    {
      // §6.4 — adapter selected by MAIL_PROVIDER; `console` logs, others are out of scope
      provide: MAIL_PROVIDER,
      inject: [CONFIG],
      useFactory: (config: Config): MailProvider =>
        config.MAIL_PROVIDER === 'console'
          ? new ConsoleMailProvider()
          : new UnsupportedMailProvider(config.MAIL_PROVIDER),
    },
  ],
  // BullModule is re-exported so tests / health can `@InjectQueue('mail')` via MailModule.
  exports: [MailService, BullModule],
})
export class MailModule {}
