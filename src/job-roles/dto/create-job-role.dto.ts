import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { UserRole } from '@prisma/client';

export class CreateJobRoleDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(60)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  nameAr?: string;

  /** What people with this role can do: WORKER gets tasks in the app, ADMIN/MANAGER use the dashboard. */
  @IsEnum(UserRole)
  access!: UserRole;
}
