import { IsDateString, IsEnum, IsInt, IsOptional, IsString, Min, IsBoolean } from 'class-validator';
import { TaskPriority } from '@prisma/client';

export class UpdateTaskDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsEnum(TaskPriority) priority?: TaskPriority;
  @IsOptional() @IsDateString() deadline?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsString() location?: string;

  @IsOptional() @IsInt() @Min(0) minPhotosRequired?: number;
  @IsOptional() @IsInt() @Min(0) minFilesRequired?: number;
  @IsOptional() @IsBoolean() requiresChecklist?: boolean;
}