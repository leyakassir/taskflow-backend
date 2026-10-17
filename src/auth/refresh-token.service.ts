import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import type { User } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';

const SESSION_ENDED = 'Session ended, please sign in again';

const hashToken = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/**
 * Mobile sessions: a short access token (MOBILE_ACCESS_TOKEN_SECONDS,
 * default 15 minutes) and a refresh token (REFRESH_TOKEN_TTL_DAYS, default
 * 30 days) that the app trades for a new pair when the access token expires.
 */
@Injectable()
export class RefreshTokenService {
  private readonly accessSeconds: number;
  private readonly refreshDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    this.accessSeconds = positive(config.get('MOBILE_ACCESS_TOKEN_SECONDS'), 900);
    this.refreshDays = positive(config.get('REFRESH_TOKEN_TTL_DAYS'), 30);
  }

  /** A new access token and refresh token for [user]. */
  async issue(user: Pick<User, 'id' | 'role' | 'avatarUrl'>) {
    const accessToken = await this.jwt.signAsync(
      { sub: user.id, role: user.role, avatarUrl: user.avatarUrl },
      { expiresIn: this.accessSeconds },
    );
    const refreshToken = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: new Date(Date.now() + this.refreshDays * 86_400_000),
      },
    });
    return { accessToken, refreshToken, expiresIn: this.accessSeconds };
  }

  /** Trades a valid refresh token for a new pair; the old one stops working. */
  async refresh(refreshToken: string) {
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(refreshToken) },
      include: { user: true },
    });
    if (!stored) throw new UnauthorizedException(SESSION_ENDED);

    if (stored.revokedAt) {
      // A replaced token came back: someone else may hold a copy.
      await this.revokeAllForUser(stored.userId);
      throw new UnauthorizedException(SESSION_ENDED);
    }

    const { user } = stored;
    const passwordResetSince =
      user.passwordChangedAt !== null &&
      user.passwordChangedAt.getTime() > stored.createdAt.getTime();
    if (
      stored.expiresAt.getTime() <= Date.now() ||
      !user.isActive ||
      passwordResetSince
    ) {
      await this.revoke(stored.id);
      throw new UnauthorizedException(SESSION_ENDED);
    }

    // Only one caller can replace this token, even with parallel requests.
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) throw new UnauthorizedException(SESSION_ENDED);

    return this.issue(user);
  }

  /** Logout: the refresh token stops working. Unknown tokens are ignored. */
  async revokeToken(refreshToken: string) {
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async revoke(id: string) {
    await this.prisma.refreshToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

function positive(raw: unknown, fallback: number): number {
  const value = Number(raw ?? fallback);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}
