import { IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateSignupRequestDto {
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  fullName!: string;

  @IsEmail()
  email!: string;

  /** Becomes the account password once an admin approves. */
  @IsString()
  @MinLength(8)
  password!: string;

  /** Language of the emails; defaults to English. */
  @IsOptional()
  @IsIn(['en', 'ar'])
  lang?: 'en' | 'ar';
}
