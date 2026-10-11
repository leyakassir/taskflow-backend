import { Injectable } from '@nestjs/common';
import { AuditAction, Prisma } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { ListAuditLogsQueryDto } from './dto/list-audit-logs-query.dto.js';

type Db = Prisma.TransactionClient | PrismaService;

export type AuditEntry = {
  action: AuditAction;
  actorId?: string | null;
  taskId?: string | null;
  targetUserId?: string | null;
  details?: Prisma.InputJsonObject;
};

export type FieldChanges = Record<string, { from: Prisma.InputJsonValue | null; to: Prisma.InputJsonValue | null }>;

const MAX_TEXT = 160;

function snapshot(value: unknown): Prisma.InputJsonValue | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string' && value.length > MAX_TEXT) return `${value.slice(0, MAX_TEXT)}…`;
  return value as Prisma.InputJsonValue;
}

/** The fields that differ between two versions of a record, as { field: { from, to } }. */
export function diffFields<T extends object>(before: T, after: T, fields: (keyof T & string)[]): FieldChanges {
  const changes: FieldChanges = {};
  for (const field of fields) {
    const from = snapshot(before[field]);
    const to = snapshot(after[field]);
    if (JSON.stringify(from) !== JSON.stringify(to)) changes[field] = { from, to };
  }
  return changes;
}

const PERSON = { select: { id: true, fullName: true, role: true, avatarUrl: true } } as const;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Pass the transaction client so the entry is saved (or rolled back) together with the change. */
  record(entry: AuditEntry, db: Db = this.prisma) {
    return db.auditLog.create({
      data: {
        action: entry.action,
        actorId: entry.actorId ?? null,
        taskId: entry.taskId ?? null,
        targetUserId: entry.targetUserId ?? null,
        details: entry.details,
      },
    });
  }

  /** Newest first, paged with a cursor (the id of the last entry already shown). */
  async list(query: ListAuditLogsQueryDto) {
    const limit = Math.min(query.limit ?? 50, 100);
    const where: Prisma.AuditLogWhereInput = {};
    if (query.taskId) where.taskId = query.taskId;
    if (query.userId) where.OR = [{ actorId: query.userId }, { targetUserId: query.userId }];
    if (query.actions?.length) where.action = { in: query.actions };

    const rows = await this.prisma.auditLog.findMany({
      where,
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      include: {
        actor: PERSON,
        targetUser: PERSON,
        task: { select: { id: true, title: true, status: true } },
      },
    });

    const hasMore = rows.length > limit;
    const data = hasMore ? rows.slice(0, limit) : rows;
    return { data, nextCursor: hasMore ? data[data.length - 1].id : null };
  }
}
