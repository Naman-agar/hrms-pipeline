// TPRD 01 §6.4 — Mail service.
//
// `mail.service.send(job)` ONLY enqueues `{ template, to, vars }` onto the BullMQ
// queue `mail` (attempts 3, exponential backoff 5 s). It never renders or
// delivers anything — that is `MailProcessor`'s job — so callers (04 §4.7
// invite flow) return as soon as Redis has accepted the job, after their
// transaction has committed.
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Job, JobsOptions, Queue } from 'bullmq';
import { MAIL_QUEUE, MailJob, MailTemplate } from './mail.types';

/** §6.4 — attempts 3, exponential backoff starting at 5 s (5 s, 10 s, then failed). */
export const MAIL_JOB_OPTIONS: JobsOptions = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5000 },
};

@Injectable()
export class MailService {
  constructor(@InjectQueue(MAIL_QUEUE) private readonly queue: Queue<MailJob>) {}

  /**
   * §6.4 — enqueue one mail job. Resolves once the job is stored in Redis;
   * delivery happens later in the worker. The job name is the template name.
   */
  async send<T extends MailTemplate>(job: MailJob<T>): Promise<Job<MailJob>> {
    // §6.4 — enqueue { template, to, vars } with attempts 3 / exponential backoff 5 s
    return this.queue.add(job.template, job, MAIL_JOB_OPTIONS);
  }
}
