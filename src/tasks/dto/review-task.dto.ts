import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class ReviewTaskDto {
  @IsIn(['APPROVE', 'SEND_BACK'])
  decision!: 'APPROVE' | 'SEND_BACK';

  /** Required when sending back: tells the worker what to fix. Optional comment on approve. */
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  /** Send back only: hand the task to a different worker instead of the one who submitted it. */
  @IsOptional()
  @IsString()
  assigneeId?: string;
}
