import type { Request } from 'express';
import type { UserRole } from '@prisma/client';

export type RequestUser = {
  id: string;
  role: UserRole;
};

export interface AuthenticatedRequest extends Request {
  user: RequestUser;
}