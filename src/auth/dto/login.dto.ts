import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  /**
   * "mobile": the session uses a 15-minute access token plus a refresh token
   * (POST /auth/refresh). Without it (the dashboard) the access token lasts
   * JWT_EXPIRES_IN_SECONDS and no refresh token is issued.
   */
  @IsOptional()
  @IsIn(['mobile'])
  client?: 'mobile';
}
