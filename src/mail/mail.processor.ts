// TPRD 01 §6.4 — Mail worker.
//
// For each job on the `mail` queue: render `templates/<template>.hbs` with
// Handlebars using `vars`, then hand the result to the provider adapter chosen
// by `MAIL_PROVIDER`. Any throw here (unknown template, provider failure) makes
// BullMQ retry per the job options set in `mail.service.ts` (attempts 3,
// exponential backoff) and then mark the job failed (AC-F6).
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject } from '@nestjs/common';
import { Job } from 'bullmq';
import Handlebars from 'handlebars';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CONFIG, Config } from '../config/config';
import { MAIL_QUEUE, MailJob, MailTemplate } from './mail.types';
import { MAIL_PROVIDER, MailProvider } from './providers/mail-provider.interface';

/** Subject line per template (the job payload carries none — §6.4 is `{ template, to, vars }`). */
const TEMPLATE_SUBJECTS: Record<MailTemplate, string> = {
  invite: 'You have been invited to HRMS',
};

/** `src/mail/templates` in ts-node/vitest; `dist/mail/templates` after `nest build` (nest-cli assets). */
const TEMPLATES_DIR = join(__dirname, 'templates');

@Processor(MAIL_QUEUE)
export class MailProcessor extends WorkerHost {
  private readonly compiled = new Map<MailTemplate, HandlebarsTemplateDelegate>();

  constructor(
    @Inject(CONFIG) private readonly config: Config,
    @Inject(MAIL_PROVIDER) private readonly provider: MailProvider,
  ) {
    super();
  }

  override async process(job: Job<MailJob>): Promise<void> {
    const { template, to, vars } = job.data;

    // §6.4 — render templates/<template>.hbs with `vars`
    const render = await this.compile(template);
    const html = render(vars);

    // §6.4 — call the provider adapter selected by MAIL_PROVIDER (throws → BullMQ retry)
    await this.provider.send({
      to,
      from: this.config.MAIL_FROM,
      subject: TEMPLATE_SUBJECTS[template],
      html,
    });
  }

  /** Load + compile a template once per worker; the name must be a known template (no path input). */
  private async compile(template: MailTemplate): Promise<HandlebarsTemplateDelegate> {
    if (!Object.hasOwn(TEMPLATE_SUBJECTS, template)) {
      throw new Error(`Unknown mail template "${String(template)}"`);
    }
    const cached = this.compiled.get(template);
    if (cached) return cached;

    const source = await readFile(join(TEMPLATES_DIR, `${template}.hbs`), 'utf8');
    const delegate = Handlebars.compile(source);
    this.compiled.set(template, delegate);
    return delegate;
  }
}
