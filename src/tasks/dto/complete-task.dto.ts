import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

class ChecklistResultDto {
  @IsUUID()
  id: string;

  @IsBoolean()
  done: boolean;
}

class AttachmentInputDto {
  @IsString()
  url: string;

  @IsString()
  mimeType: string;

  @IsInt()
  sizeBytes: number;
}

export class CompleteTaskDto {
  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChecklistResultDto)
  checklistResults?: ChecklistResultDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttachmentInputDto)
  photos?: AttachmentInputDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttachmentInputDto)
  files?: AttachmentInputDto[];
}