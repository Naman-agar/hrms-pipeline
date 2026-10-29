// TPRD 03 §5 step 1 — `{id}` path parameter must be a uuid, otherwise 400
// VALIDATION_ERROR via the standard nestjs-zod pipe → global filter path.
//
// Per docs/decisions.md this check is applied uniformly to every `users/:id`
// route (detail, update, delete, restore), mirroring `RoleIdSchema` (01 §7).
import { z } from 'zod';

export const UserIdSchema = z.string().uuid();
