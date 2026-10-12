import { SignupRequestStatus } from '@prisma/client';
import { IsIn, IsOptional } from 'class-validator';

export class ListSignupRequestsQueryDto {
  /** PENDING (default), APPROVED, REJECTED or ALL. Unverified ones are never listed. */
  @IsOptional()
  @IsIn([SignupRequestStatus.PENDING, SignupRequestStatus.APPROVED, SignupRequestStatus.REJECTED, 'ALL'])
  status?: SignupRequestStatus | 'ALL';
}
