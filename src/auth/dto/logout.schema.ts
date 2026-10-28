// TPRD 02 §1 / §3.3 — `POST /auth/logout` body: `{ refreshToken }`.
//
// Same shape as the refresh body but kept as its own schema so the two
// endpoints can diverge independently later.
import { z } from 'zod';

export const LogoutSchema = z.object({
  refreshToken: z.string().min(1),
});
export type LogoutDto = z.infer<typeof LogoutSchema>;
