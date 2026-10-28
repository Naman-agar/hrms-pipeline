// TPRD 01 §6.4 — provider adapter contract.
//
// `MailProcessor` renders the template and hands the result to whichever adapter
// `MAIL_PROVIDER` selects (`console` | `ses` | `sendgrid`). Only `console` is
// implemented in TPRD 01; the others are out of scope and throw when used.

/** Injection token for the adapter chosen from `config.MAIL_PROVIDER`. */
export const MAIL_PROVIDER = Symbol('MAIL_PROVIDER');

/** A fully rendered email, ready to hand to a transport. */
export interface RenderedMail {
  to: string;
  /** Always `config.MAIL_FROM`. */
  from: string;
  subject: string;
  /** Rendered Handlebars output. */
  html: string;
}

export interface MailProvider {
  /** Deliver one rendered email. Throwing makes BullMQ retry the job (§6.4: attempts 3). */
  send(mail: RenderedMail): Promise<void>;
}
