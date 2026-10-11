import { AuditAction } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsArray, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class ListAuditLogsQueryDto {
  @IsOptional()
  @IsString()
  taskId?: string;

  /** Entries where this user acted or was acted on. */
  @IsOptional()
  @IsString()
  userId?: string;

  /** Comma-separated, e.g. ?actions=TASK_APPROVED,TASK_SENT_BACK */
  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value
          .split(',')
          .map((part) => part.trim())
          .filter(Boolean)
      : value,
  )
  @IsArray()
  @IsEnum(AuditAction, { each: true })
  actions?: AuditAction[];

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}
