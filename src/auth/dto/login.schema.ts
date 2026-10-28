// TPRD 02 §3.1 step 1 — `POST /auth/login` body.
//
// "Validate body with zod: `email` (string, email, lower-cased + trimmed),
// `password` (string, min 1)." Normalisation happens here so the service and
// the rate-limit guard (which re-applies the same trim + lower-case to the raw
// body) agree on the key for `login:<email>`.
import { z } from 'zod';

export const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
});
export type LoginDto = z.infer<typeof LoginSchema>;
