// TPRD 03 §4.1 — query string for `GET /users` (zod `ListUsersQuery`).
//
// Every rule in the §4.1 table is encoded here so the service receives a fully
// defaulted, typed object; anything invalid is a 400 VALIDATION_ERROR via the
// standard nestjs-zod pipe → global filter path (nothing custom).
//
// `page` / `page_size` are not re-declared: the shared `PaginationSchema`
// (01 §6.2, `src/common/dto/pagination.dto.ts`) is merged in so the 10/25/50/100
// rule lives in exactly one place.
//
// Query params are snake_case on the wire (`role_id`, `department_id`,
// `page_size`); the service translates to Prisma's camelCase columns.
import { UserStatus } from '@prisma/client';
import { z } from 'zod';
import { PaginationSchema } from '../../common/dto/pagination.dto';

/** §4.1 — `search` upper bound; AC-U2: 101 chars → 400. */
export const SEARCH_MAX = 100;

/** §4.1 — sortable columns; maps to §4.3 `orderBy` in the service. */
export const USER_SORT_FIELDS = [
  'name',
  'email',
  'department',
  'role',
  'status',
  'last_login',
] as const;
export type UserSortField = (typeof USER_SORT_FIELDS)[number];

export const SORT_ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

export const ListUsersQuerySchema = PaginationSchema.extend({
  // §4.1 — string, trim, max 100; an empty (or whitespace-only) string is treated as absent
  search: z
    .string()
    .trim()
    .max(SEARCH_MAX)
    .optional()
    .transform((value) => (value === '' ? undefined : value)),
  // §4.1 — enum invited/active/inactive/suspended (the Prisma `UserStatus` enum, 01 §4)
  status: z.nativeEnum(UserStatus).optional(),
  // §4.1 — uuid
  role_id: z.string().uuid().optional(),
  // §4.1 — uuid
  department_id: z.string().uuid().optional(),
  // §4.1 — enum name/email/department/role/status/last_login, default name
  sort: z.enum(USER_SORT_FIELDS).default('name'),
  // §4.1 — enum asc/desc, default asc
  order: z.enum(SORT_ORDERS).default('asc'),
});

/** Parsed (output) shape: `sort`, `order`, `page`, `page_size` are always present after defaults. */
export type ListUsersQueryDto = z.infer<typeof ListUsersQuerySchema>;
