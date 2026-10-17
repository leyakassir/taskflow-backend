import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { AuditAction, Prisma, type UserRole } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService, diffFields } from '../audit/audit.service.js';
import type { RequestUser } from '../common/interfaces/authenticated-request.interface.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { UpdatePasswordDto } from './dto/update-password.dto.js';
import { ChangePasswordSelfDto } from './dto/change-password-self.dto.js';

const JOB_ROLE = { select: { id: true, name: true, nameAr: true, access: true } } as const;

// What the activity log shows as someone's role: their company role when they have one.
const roleLabel = (u: { role: UserRole; jobRole?: { name: string } | null }) => u.jobRole?.name ?? u.role;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(dto: CreateUserDto, actor: RequestUser) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) throw new BadRequestException('Email already in use');
    const jobRole = dto.jobRoleId ? await this.findJobRole(dto.jobRoleId) : null;
    const passwordHash = await bcrypt.hash(dto.password, 10);
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email: dto.email,
          fullName: dto.fullName,
          role: jobRole?.access ?? dto.role,
          jobRoleId: jobRole?.id ?? null,
          isActive: true,
          passwordHash,
        },
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          isActive: true,
          jobRole: JOB_ROLE,
        },
      });
      await this.audit.record(
        {
          action: AuditAction.USER_CREATED,
          actorId: actor.id,
          targetUserId: user.id,
          details: { fullName: user.fullName, email: user.email, role: user.role, roleName: jobRole?.name ?? null },
        },
        tx,
      );
      return user;
    });
  }

  async findAll(params?: {
    role?: string;
    isActive?: boolean;
    search?: string;
  }) {
    const where: any = {};
    if (params?.role) where.role = params.role;
    if (typeof params?.isActive === 'boolean') where.isActive = params.isActive;
    if (params?.search) {
      where.OR = [
        { email: { contains: params.search, mode: 'insensitive' } },
        { fullName: { contains: params.search, mode: 'insensitive' } },
      ];
    }
    return this.prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        jobRole: JOB_ROLE,
        isActive: true,
        avatarUrl: true,
        createdAt: true,
      },
    });
  }

  async findOne(id: string) {
    const u = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        jobRole: JOB_ROLE,
        isActive: true,
        avatarUrl: true,
        createdAt: true,
      },
    });
    if (!u) throw new NotFoundException('User not found');
    return u;
  }

  async update(id: string, dto: UpdateUserDto, actor: RequestUser) {
    const before = await this.prisma.user.findUnique({ where: { id }, include: { jobRole: true } });
    if (!before) throw new NotFoundException('User not found');

    const { jobRoleId, role, ...rest } = dto;
    const data: Prisma.UserUncheckedUpdateInput = { ...rest };
    if (jobRoleId) {
      const jobRole = await this.findJobRole(jobRoleId);
      data.jobRoleId = jobRole.id;
      data.role = jobRole.access;
    } else if (jobRoleId === null) {
      data.jobRoleId = null;
      if (role) data.role = role;
    } else if (role && role !== before.role) {
      // Picking a different built-in role replaces the company one.
      data.role = role;
      data.jobRoleId = null;
    }

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data,
        select: {
          id: true,
          email: true,
          fullName: true,
          role: true,
          jobRole: JOB_ROLE,
          isActive: true,
          avatarUrl: true,
          createdAt: true,
        },
      });
      const { isActive, ...changes } = diffFields(before, user, ['fullName', 'isActive']);
      const [roleFrom, roleTo] = [roleLabel(before), roleLabel(user)];
      if (roleFrom !== roleTo) changes.role = { from: roleFrom, to: roleTo };
      if (isActive) await this.recordActive(tx, user, actor);
      if (Object.keys(changes).length > 0) {
        await this.audit.record(
          {
            action: AuditAction.USER_UPDATED,
            actorId: actor.id,
            targetUserId: id,
            details: { fullName: user.fullName, changes },
          },
          tx,
        );
      }
      return user;
    });
  }

  async updateAvatar(userId: string, avatarUrl: string) {
    await this.ensureExists(userId);
    return this.prisma.user.update({
      where: { id: userId },
      data: { avatarUrl },
      select: { avatarUrl: true },
    });
  }

  async updatePassword(id: string, dto: UpdatePasswordDto, actor: RequestUser) {
    const user = await this.ensureExists(id);
    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { passwordHash } });
      await this.audit.record(
        {
          action: AuditAction.USER_PASSWORD_RESET,
          actorId: actor.id,
          targetUserId: id,
          details: { fullName: user.fullName },
        },
        tx,
      );
    });
    return { success: true };
  }

  async setActive(id: string, isActive: boolean, actor: RequestUser) {
    const user = await this.ensureExists(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { isActive } });
      if (user.isActive !== isActive) await this.recordActive(tx, { id, fullName: user.fullName, isActive }, actor);
    });
    return { success: true };
  }

  private recordActive(
    tx: Prisma.TransactionClient,
    user: { id: string; fullName: string; isActive: boolean },
    actor: RequestUser,
  ) {
    return this.audit.record(
      {
        action: user.isActive ? AuditAction.USER_ACTIVATED : AuditAction.USER_DEACTIVATED,
        actorId: actor.id,
        targetUserId: user.id,
        details: { fullName: user.fullName },
      },
      tx,
    );
  }

  async registerDeviceToken(userId: string, token: string) {
    await this.ensureExists(userId);
    try {
      await this.prisma.deviceToken.upsert({
        where: { token },
        update: { userId },
        create: { token, userId },
      });
    } catch (error) {
      // The app can register the same token twice at once (login and token
      // refresh). Upsert is not atomic, so the second create can hit the
      // unique index; the row exists by then, so just point it at this user.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
        throw error;
      }
      await this.prisma.deviceToken.update({ where: { token }, data: { userId } });
    }
    return { success: true };
  }

  // Only removes the token if it belongs to the caller, so one user can
  // never unregister another user's device. Idempotent.
  async unregisterDeviceToken(userId: string, token: string) {
    await this.prisma.deviceToken.deleteMany({ where: { token, userId } });
    return { success: true };
  }

  async changeOwnPassword(id: string, dto: ChangePasswordSelfDto) {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundException('User not found');
    const ok = await bcrypt.compare(dto.currentPassword, u.passwordHash);
    if (!ok) throw new BadRequestException('Current password is incorrect');
    const newHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { passwordHash: newHash },
      });
      await this.audit.record(
        {
          action: AuditAction.USER_PASSWORD_CHANGED,
          actorId: id,
          targetUserId: id,
          details: { fullName: u.fullName },
        },
        tx,
      );
    });
    return { success: true };
  }

  private async findJobRole(id: string) {
    const jobRole = await this.prisma.jobRole.findUnique({ where: { id } });
    if (!jobRole) throw new BadRequestException('Role not found');
    return jobRole;
  }

  private async ensureExists(id: string) {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundException('User not found');
    return u;
  }
}
