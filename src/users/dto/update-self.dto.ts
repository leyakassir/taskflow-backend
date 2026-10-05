import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateSelfDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  fullName?: string;
}