import { IsEmail, IsIn, IsOptional } from 'class-validator';

export class ForgotPasswordDto {
  @IsEmail()
  email!: string;

  /** Language of the email; defaults to English. */
  @IsOptional()
  @IsIn(['en', 'ar'])
  lang?: 'en' | 'ar';
}
