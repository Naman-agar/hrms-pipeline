// TPRD 01 §7 — `@Permissions(...)` marks a route with the permission strings
// from the endpoints table's "Permission" column (e.g. `roles.manage`).
// `PermissionsGuard` (`src/common/guards/permissions.guard.ts`) reads this
// metadata and checks it against the current user's `role.permissions`.
//
//   @Post()
//   @Permissions('roles.manage')
//   create(…) { … }
import { SetMetadata } from '@nestjs/common';

/** Reflector metadata key under which the required permissions are stored. */
export const PERMISSIONS_KEY = 'permissions';

export const Permissions = (...perms: string[]) => SetMetadata(PERMISSIONS_KEY, perms);
