// TPRD 01 §7 — request bodies for the Department reference-data endpoints.
//
//   POST  /departments        `{name}`
//   PATCH /departments/{id}   `{name?, isActive?}`
//
// Field names are the ones written in the §7 table (camelCase `isActive`, as
// for the roles' `isSystem`). Validation failures surface as 400
// `VALIDATION_ERROR` through the global filter (§6.1).
import { z } from 'zod';

/** Department display name — non-empty after trimming; `@unique` in the schema (§4). */
const DepartmentNameSchema = z.string().trim().min(1);

export const CreateDepartmentSchema = z.object({
  name: DepartmentNameSchema,
});
export type CreateDepartmentDto = z.infer<typeof CreateDepartmentSchema>;

export const UpdateDepartmentSchema = z.object({
  name: DepartmentNameSchema.optional(),
  isActive: z.boolean().optional(),
});
export type UpdateDepartmentDto = z.infer<typeof UpdateDepartmentSchema>;
