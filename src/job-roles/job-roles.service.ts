import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { AuditService, diffFields } from '../audit/audit.service.js';
import type { RequestUser } from '../common/interfaces/authenticated-request.interface.js';
import { CreateJobRoleDto } from './dto/create-job-role.dto.js';
import { UpdateJobRoleDto } from './dto/update-job-role.dto.js';

// Same names as the built-in roles would make two different "Worker" options.
const BUILT_IN_NAMES = new Set(['admin', 'manager', 'worker']);

const WITH_COUNT = { _count: { select: { users: true } } } as const;

type RoleWithCount = Prisma.JobRoleGetPayload<{ include: typeof WITH_COUNT }>;

function present({ _count, ...role }: RoleWithCount) {
  return { ...role, userCount: _count.users };
}

function cleanName(name: string) {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (!trimmed) throw new BadRequestException('Role name is required');
  if (BUILT_IN_NAMES.has(trimmed.toLowerCase())) {
    throw new BadRequestException('That name is already a built-in role');
  }
  return trimmed;
}

function isDuplicateName(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

@Injectable()
export class JobRolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    const roles = await this.prisma.jobRole.findMany({ orderBy: { name: 'asc' }, include: WITH_COUNT });
    return roles.map(present);
  }

  async create(dto: CreateJobRoleDto, actor: RequestUser) {
    const name = cleanName(dto.name);
    const nameAr = dto.nameAr?.trim() || null;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const role = await tx.jobRole.create({ data: { name, nameAr, access: dto.access }, include: WITH_COUNT });
        await this.audit.record(
          {
            action: AuditAction.ROLE_CREATED,
            actorId: actor.id,
            details: { name, nameAr, access: role.access },
          },
          tx,
        );
        return present(role);
      });
    } catch (error) {
      if (isDuplicateName(error)) throw new ConflictException('A role with this name already exists');
      throw error;
    }
  }

  async update(id: string, dto: UpdateJobRoleDto, actor: RequestUser) {
    const before = await this.ensureExists(id);
    const data: Prisma.JobRoleUpdateInput = {};
    if (dto.name !== undefined) data.name = cleanName(dto.name);
    if (dto.nameAr !== undefined) data.nameAr = dto.nameAr.trim() || null;
    const accessChanged = dto.access !== undefined && dto.access !== before.access;
    if (accessChanged) {
      // Otherwise an admin could take away their own dashboard access in one click.
      const self = await this.prisma.user.findUnique({ where: { id: actor.id }, select: { jobRoleId: true } });
      if (self?.jobRoleId === id) {
        throw new BadRequestException("You can't change the access level of your own role");
      }
      data.access = dto.access;
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const role = await tx.jobRole.update({ where: { id }, data, include: WITH_COUNT });
        // User.role is what the guards check, so everyone in the role follows its access level.
        if (accessChanged) await tx.user.updateMany({ where: { jobRoleId: id }, data: { role: role.access } });
        const changes = diffFields(before, role, ['name', 'nameAr', 'access']);
        if (Object.keys(changes).length > 0) {
          await this.audit.record(
            {
              action: AuditAction.ROLE_UPDATED,
              actorId: actor.id,
              details: { name: role.name, changes, userCount: role._count.users },
            },
            tx,
          );
        }
        return present(role);
      });
    } catch (error) {
      if (isDuplicateName(error)) throw new ConflictException('A role with this name already exists');
      throw error;
    }
  }

  /** People in a deleted role keep their access and show the built-in role name again. */
  async remove(id: string, actor: RequestUser) {
    const role = await this.ensureExists(id);
    await this.prisma.$transaction(async (tx) => {
      await tx.jobRole.delete({ where: { id } });
      await this.audit.record(
        {
          action: AuditAction.ROLE_DELETED,
          actorId: actor.id,
          details: { name: role.name, nameAr: role.nameAr, access: role.access, userCount: role._count.users },
        },
        tx,
      );
    });
    return { success: true };
  }

  private async ensureExists(id: string) {
    const role = await this.prisma.jobRole.findUnique({ where: { id }, include: WITH_COUNT });
    if (!role) throw new NotFoundException('Role not found');
    return role;
  }
}
