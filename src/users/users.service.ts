import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../database/prisma.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { UpdatePasswordDto } from './dto/update-password.dto.js';
import { ChangePasswordSelfDto } from './dto/change-password-self.dto.js';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateUserDto) {
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existing) throw new BadRequestException('Email already in use');
    const passwordHash = await bcrypt.hash(dto.password, 10);
    return this.prisma.user.create({
      data: {
        email: dto.email,
        fullName: dto.fullName,
        role: dto.role,
        isActive: true,
        passwordHash,
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
      },
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
        isActive: true,
        avatarUrl: true,
        createdAt: true,
      },
    });
    if (!u) throw new NotFoundException('User not found');
    return u;
  }

  async update(id: string, dto: UpdateUserDto) {
    await this.ensureExists(id);
    return this.prisma.user.update({
      where: { id },
      data: { ...dto },
      select: {
        id: true,
        email: true,
        fullName: true,
        role: true,
        isActive: true,
        avatarUrl: true,
        createdAt: true,
      },
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

  async updatePassword(id: string, dto: UpdatePasswordDto) {
    await this.ensureExists(id);
    const passwordHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({ where: { id }, data: { passwordHash } });
    return { success: true };
  }

  async setActive(id: string, isActive: boolean) {
    await this.ensureExists(id);
    await this.prisma.user.update({ where: { id }, data: { isActive } });
    return { success: true };
  }

  async registerDeviceToken(userId: string, token: string) {
    await this.ensureExists(userId);
    await this.prisma.deviceToken.upsert({
      where: { token },
      update: { userId },
      create: { token, userId },
    });
    return { success: true };
  }

  async changeOwnPassword(id: string, dto: ChangePasswordSelfDto) {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundException('User not found');
    const ok = await bcrypt.compare(dto.currentPassword, u.passwordHash);
    if (!ok) throw new BadRequestException('Current password is incorrect');
    const newHash = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({
      where: { id },
      data: { passwordHash: newHash },
    });
    return { success: true };
  }

  private async ensureExists(id: string) {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundException('User not found');
  }
}
