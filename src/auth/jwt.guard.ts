import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../database/prisma.service.js';
import type { Request } from 'express';
import type { UserRole } from '@prisma/client';

type JwtPayload = { sub: string; role: UserRole; iat?: number; exp?: number };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req: Request & { user?: { id: string; role: UserRole } } =
      ctx.switchToHttp().getRequest();

    const auth = req.headers['authorization'];
    if (!auth) throw new UnauthorizedException('Missing Authorization header');

    const [scheme, token] = (auth as string).split(' ');
    if (scheme !== 'Bearer' || !token) {
      throw new UnauthorizedException('Invalid Authorization header');
    }

    let payload: JwtPayload;
    try {
      payload = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }

    // Ensure the user still exists and is active
    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, isActive: true },
    });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('User not found or inactive');
    }

    // Attach to request for RolesGuard and services
    req.user = { id: user.id, role: user.role };
    return true;
    }
}