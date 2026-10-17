import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../database/prisma.service.js';
import { RefreshTokenService } from './refresh-token.service.js';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly refreshTokens: RefreshTokenService,
  ) {}

  /**
   * [client] "mobile" gets a 15-minute access token plus a refresh token;
   * otherwise (dashboard) a single access token of JWT_EXPIRES_IN_SECONDS.
   */
  async login(email: string, password: string, client?: 'mobile') {
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const profile = {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
    };

    if (client === 'mobile') {
      const tokens = await this.refreshTokens.issue(user);
      return { ...tokens, user: profile };
    }

    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      role: user.role,
      avatarUrl: user.avatarUrl,
    });

    return {
      accessToken,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        role: user.role,
      },
    };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive)
      throw new UnauthorizedException('Unauthorized');

    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
      avatarUrl: user.avatarUrl,
    };
  }
}
