import { Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { ForgotPasswordDto } from './dto/forgot-password.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { VerifyResetCodeDto } from './dto/verify-reset-code.dto.js';
import { PasswordResetService } from './password-reset.service.js';
import { JwtAuthGuard } from './jwt.guard.js';
import type { AuthenticatedRequest } from '../common/interfaces/authenticated-request.interface.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  /**
   * Emails a 6-digit reset code. Always answers the same, whether or not the
   * email has an account, so it can't be used to find accounts.
   */
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('forgot-password')
  @HttpCode(200)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    await this.passwordReset.requestCode(dto.email, dto.lang);
    return { success: true };
  }

  /** Checks the emailed code without using it up, so a client can confirm it before asking for the new password. */
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('verify-reset-code')
  @HttpCode(200)
  async verifyResetCode(@Body() dto: VerifyResetCodeDto) {
    await this.passwordReset.verifyCode(dto.email, dto.code);
    return { success: true };
  }

  /** Sets a new password with the emailed code; signs out other sessions. */
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.passwordReset.resetPassword(dto.email, dto.code, dto.newPassword);
    return { success: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: AuthenticatedRequest) {
    return this.authService.me(req.user!.id);
  }
}
