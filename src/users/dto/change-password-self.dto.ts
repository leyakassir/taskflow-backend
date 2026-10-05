import { IsString, MinLength } from 'class-validator';

export class ChangePasswordSelfDto {
  @IsString()
  @MinLength(8)
  currentPassword!: string;

  @IsString()
  @MinLength(8)
  newPassword!: string;
}