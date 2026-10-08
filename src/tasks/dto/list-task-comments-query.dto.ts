import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min } from 'class-validator';

// Same page/limit style as ListTasksQueryDto (limit is capped at 100).
export class ListTaskCommentsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit = 20;
}
