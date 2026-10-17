import { IsBoolean, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { UserRole } from '@prisma/client';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  fullName?: string;

  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  /** A company role from /job-roles; null goes back to the built-in role. */
  @IsOptional()
  @IsString()
  jobRoleId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}