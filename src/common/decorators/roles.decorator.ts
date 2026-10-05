import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';

export const ROLES_KEY = 'roles';

/**
 * Attach to a controller method to restrict access by role.
 * Use together with RolesGuard (and after JwtAuthGuard).
 *
 * Example:
 *   @UseGuards(JwtAuthGuard, RolesGuard)
 *   @Roles(UserRole.ADMIN, UserRole.MANAGER)
 *   @Post()
 *   createTask(...) { ... }
 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);