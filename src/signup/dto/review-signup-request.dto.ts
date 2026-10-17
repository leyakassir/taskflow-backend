import { UserRole } from '@prisma/client';
import { IsEnum, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ApproveSignupRequestDto {
  /** Role of the new account; WORKER when omitted. ADMIN can't be granted here. */
  @IsOptional()
  @IsEnum(UserRole)
  @IsIn([UserRole.WORKER, UserRole.MANAGER])
  role?: UserRole;
}

export class RejectSignupRequestDto {
  /** Optional reason, included in the email to the person. */
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reason?: string;
}
