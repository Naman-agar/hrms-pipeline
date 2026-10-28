// TPRD 01 §7 — request bodies for the Role endpoints.
//
// `POST /roles` body is `{name, permissions[]}` (§7 table). The PATCH body shape
// is not detailed beyond the SYSTEM_ROLE rule on a name change, so it accepts
// the same two fields, both optional (docs/decisions.md).
//
// Field names are already single words, so there is no snake_case/camelCase
// translation to do here.
import { z } from 'zod';

/** Upper bound on a role name; the column is unbounded `String`, this is only a sanity limit. */
export const ROLE_NAME_MAX = 100;

export const CreateRoleSchema = z.object({
  name: z.string().trim().min(1).max(ROLE_NAME_MAX),
  permissions: z.array(z.string().trim().min(1)),
});
export type CreateRoleDto = z.infer<typeof CreateRoleSchema>;

export const UpdateRoleSchema = z.object({
  name: z.string().trim().min(1).max(ROLE_NAME_MAX).optional(),
  permissions: z.array(z.string().trim().min(1)).optional(),
});
export type UpdateRoleDto = z.infer<typeof UpdateRoleSchema>;

/** `{id}` path parameter: Prisma ids are uuids (§4), anything else cannot match a row. */
export const RoleIdSchema = z.string().uuid();
