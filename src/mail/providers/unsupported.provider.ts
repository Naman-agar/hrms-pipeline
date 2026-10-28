// TPRD 01 §6.4 — placeholder for `ses` / `sendgrid`, which are outside this
// TPRD's scope. The app still boots with those values (config accepts them);
// every job then fails inside the worker with a plain Error so BullMQ's
// retry/failure path (§6.4: attempts 3, exponential backoff) applies. This is
// an internal worker failure, not an HTTP response, so it is not an AppError.
import { MailProvider } from './mail-provider.interface';

export class UnsupportedMailProvider implements MailProvider {
  constructor(private readonly name: string) {}

  async send(): Promise<void> {
    throw new Error(
      `MAIL_PROVIDER "${this.name}" is not implemented (TPRD 01 ships only "console")`,
    );
  }
}
