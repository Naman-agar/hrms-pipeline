// TPRD 01 §6.4 — shared shapes for the mail queue.
//
// A job is exactly `{ template, to, vars }` (§6.4). The template name doubles as
// the file name under `src/mail/templates/<template>.hbs`, so the union below is
// the list of templates that exist on disk. 04-user-invite enqueues `invite`.

/** BullMQ queue name (§6.4). */
export const MAIL_QUEUE = 'mail';

/** Variables each template expects (§6.4: invite.hbs → firstName, inviteUrl, expiresInHours). */
export interface MailTemplateVars {
  invite: {
    firstName: string;
    inviteUrl: string;
    expiresInHours: number;
  };
}

/** Name of a template file in `src/mail/templates/`. */
export type MailTemplate = keyof MailTemplateVars;

/** Payload stored on the `mail` queue (§6.4). */
export interface MailJob<T extends MailTemplate = MailTemplate> {
  template: T;
  to: string;
  vars: MailTemplateVars[T];
}
