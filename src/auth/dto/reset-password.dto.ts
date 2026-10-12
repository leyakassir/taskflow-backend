import { IsEmail, IsString, Matches, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @IsEmail()
  email!: string;

  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code!: string;

  /** Same rule as changing the password in the app. */
  @IsString()
  @MinLength(8)
  newPassword!: string;
}
