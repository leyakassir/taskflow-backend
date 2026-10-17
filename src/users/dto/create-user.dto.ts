import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { UserRole } from '@prisma/client';

export class CreateUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  fullName!: string;

  @IsEnum(UserRole)
  role!: UserRole;

  /** A company role from /job-roles. When set, its access level replaces role. */
  @IsOptional()
  @IsString()
  jobRoleId?: string;

  @IsString()
  @MinLength(8)
  password!: string;
}