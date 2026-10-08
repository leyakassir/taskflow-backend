import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';

export class CreateTaskCommentDto {
  @ApiProperty({ minLength: 1, maxLength: 1000, description: 'Trimmed before validation' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @Length(1, 1000)
  body!: string;
}
