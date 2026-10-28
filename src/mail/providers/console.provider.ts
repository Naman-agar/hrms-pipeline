// TPRD 01 §6.4 — `console` adapter: "just logs the rendered mail — use it in
// dev and tests" (AC-F6: the rendered email is logged within 5 s).
import { Injectable, Logger } from '@nestjs/common';
import { MailProvider, RenderedMail } from './mail-provider.interface';

@Injectable()
export class ConsoleMailProvider implements MailProvider {
  // Nest's own Logger: works without LoggerModule in unit tests and is routed
  // to pino once main.ts calls `app.useLogger(app.get(Logger))` (nestjs-pino).
  private readonly logger = new Logger(ConsoleMailProvider.name);

  async send(mail: RenderedMail): Promise<void> {
    // §6.4 — log the whole rendered email (to/from/subject/html); nothing is delivered
    this.logger.log({
      msg: 'mail.rendered',
      to: mail.to,
      from: mail.from,
      subject: mail.subject,
      html: mail.html,
    });
  }
}
