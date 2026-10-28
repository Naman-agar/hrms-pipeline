// TPRD 02 §3.2 step 1 — `POST /auth/refresh` body: `{ refreshToken }`.
//
// Only presence is validated; whether the opaque token is real is decided by
// the hash lookup in §3.2 step 2 (a malformed token simply finds no row → 401).
import { z } from 'zod';

export const RefreshSchema = z.object({
  refreshToken: z.string().min(1),
});
export type RefreshDto = z.infer<typeof RefreshSchema>;
