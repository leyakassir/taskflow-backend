import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { TaskAttachmentKind, TaskPriority, TaskStatus, UserRole } from '@prisma/client';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { UpdateTaskDto } from './dto/update-task.dto.js';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto.js';
import { CompleteTaskDto } from './dto/complete-task.dto.js';
import type { RequestUser } from '../common/interfaces/authenticated-request.interface.js';
import { NotificationsService } from '../notifications/notifications.service.js';

const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  ASSIGNED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  OVERDUE: ['IN_PROGRESS', 'CANCELLED'],
  CANCELLED: [],
};

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

@Injectable()
export class TasksService {
  constructor(
    private prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  private async ensureAssigneeIsActiveWorker(assigneeId: string) {
    const assignee = await this.prisma.user.findUnique({ where: { id: assigneeId } });
    if (!assignee) throw new BadRequestException('Assignee does not exist');
    if (assignee.role !== UserRole.WORKER || !assignee.isActive) {
      throw new BadRequestException('Assignee must be an active WORKER');
    }
  }

  private assertCanAccess(task: { assigneeId: string }, user: RequestUser) {
    const isOwner = task.assigneeId === user.id;
    const isPrivileged = user.role === UserRole.ADMIN || user.role === UserRole.MANAGER;
    if (!isOwner && !isPrivileged) {
      throw new ForbiddenException('You do not have access to this task');
    }
  }

  async create(dto: CreateTaskDto, createdBy: RequestUser) {
    await this.ensureAssigneeIsActiveWorker(dto.assigneeId);

    const task = await this.prisma.task.create({
      data: {
        title: dto.title,
        description: dto.description,
        priority: dto.priority as TaskPriority,
        deadline: dto.deadline ? new Date(dto.deadline) : addDays(new Date(), 7),
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        location: dto.location,
        minPhotosRequired: dto.minPhotosRequired ?? 0,
        minFilesRequired: dto.minFilesRequired ?? 0,
        requiresChecklist: !!dto.checklistItems?.length,
        assigneeId: dto.assigneeId,
        createdById: createdBy.id,
        checklistItems: dto.checklistItems
          ? { create: dto.checklistItems.map((c: { label: string }) => ({ label: c.label })) }
          : undefined,
      },
      include: { checklistItems: true, attachments: true },
    });
    await this.notifications.sendTaskNotification(
      task.assigneeId,
      'New task assigned',
      task.title,
      task.id,
    );
    return task;
  }

  async updateTask(taskId: string, dto: UpdateTaskDto) {
    // Exists?
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Task not found');

    return this.prisma.task.update({
      where: { id: taskId },
      data: {
        title: dto.title ?? undefined,
        description: dto.description ?? undefined,
        priority: dto.priority ?? undefined,
        deadline: dto.deadline ? new Date(dto.deadline) : undefined,
        startDate: dto.startDate ? new Date(dto.startDate) : undefined,
        location: dto.location ?? undefined,
        minPhotosRequired: typeof dto.minPhotosRequired === 'number' ? dto.minPhotosRequired : undefined,
        minFilesRequired: typeof dto.minFilesRequired === 'number' ? dto.minFilesRequired : undefined,
        requiresChecklist: typeof dto.requiresChecklist === 'boolean' ? dto.requiresChecklist : undefined,
      },
      include: { checklistItems: true, attachments: true },
    });
  }

  async assignTask(taskId: string, assigneeId: string) {
    await this.ensureAssigneeIsActiveWorker(assigneeId);
    const t = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!t) throw new NotFoundException('Task not found');
    if (['COMPLETED', 'CANCELLED'].includes(t.status)) {
      throw new BadRequestException('Cannot reassign a finalized task');
    }
    return this.prisma.task.update({
      where: { id: taskId },
      data: { assigneeId },
      include: { checklistItems: true, attachments: true },
    });
  }

  async findAllForUser(user: RequestUser, page = 1, requestedLimit = 20) {
    const where = user.role === UserRole.WORKER ? { assigneeId: user.id } : undefined;
    const limit = Math.min(requestedLimit, 100);
    const [data, total] = await Promise.all([
      this.prisma.task.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        include: { checklistItems: true, attachments: true },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.task.count({ where }),
    ]);
    return { data, page, limit, total, totalPages: Math.ceil(total / limit) };
  }

  async findOneForUser(taskId: string, user: RequestUser) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { checklistItems: true, attachments: true },
    });
    if (!task) throw new NotFoundException('Task not found');
    this.assertCanAccess(task, user);
    return task;
  }

  async updateStatus(taskId: string, dto: UpdateTaskStatusDto, user: RequestUser) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Task not found');
    this.assertCanAccess(task, user);

    const allowedNext = ALLOWED_TRANSITIONS[task.status] ?? [];
    if (!allowedNext.includes(dto.status)) {
      throw new BadRequestException(`Cannot transition task from ${task.status} to ${dto.status}`);
    }
    const updated = await this.prisma.task.update({ where: { id: taskId }, data: { status: dto.status } });
    await this.notifications.sendTaskNotification(
      updated.assigneeId,
      'Task status updated',
      `${updated.title}: ${updated.status}`,
      updated.id,
    );
    return updated;
  }

  async complete(taskId: string, dto: CompleteTaskDto, user: RequestUser) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { checklistItems: true },
    });
    if (!task) throw new NotFoundException('Task not found');

    if (user.role === UserRole.WORKER && task.assigneeId !== user.id) {
      throw new ForbiddenException('You are not assigned to this task');
    }

    // Must be IN_PROGRESS to complete
    if (task.status !== 'IN_PROGRESS') {
      throw new BadRequestException('Task must be IN_PROGRESS before completion');
    }

    // Checklist validation (ownership + duplicates)
    const requiredIds = task.checklistItems.map((c) => c.id);
    const validTaskChecklistIds = new Set(requiredIds);
    const submittedChecklistIds = (dto.checklistResults ?? []).map((c) => c.id);
    const invalidIds = submittedChecklistIds.filter((id) => !validTaskChecklistIds.has(id));
    if (invalidIds.length > 0) {
      throw new BadRequestException(`Checklist items [${invalidIds.join(', ')}] do not belong to task ${taskId}`);
    }
    if (new Set(submittedChecklistIds).size !== submittedChecklistIds.length) {
      throw new BadRequestException('Checklist item IDs must be unique');
    }

    if (task.requiresChecklist) {
      const doneIds = new Set((dto.checklistResults ?? []).filter((c) => c.done).map((c) => c.id));
      const allDone = requiredIds.every((id) => doneIds.has(id));
      if (!allDone) {
        throw new BadRequestException('All checklist items must be completed before submitting');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      if (dto.checklistResults?.length) {
        for (const c of dto.checklistResults) {
          const res = await tx.taskChecklistItem.updateMany({
            where: { id: c.id, taskId },
            data: { done: c.done },
          });
          if (res.count !== 1) {
            throw new BadRequestException('Failed to update checklist item - data integrity error');
          }
        }
      }

      const attachmentRows = [
        ...(dto.photos ?? []).map((p) => ({
          ...p,
          kind: TaskAttachmentKind.COMPLETION_PHOTO,
          taskId,
        })),
        ...(dto.files ?? []).map((f) => ({
          ...f,
          kind: TaskAttachmentKind.COMPLETION_FILE,
          taskId,
        })),
      ];
      if (attachmentRows.length) {
        await tx.taskAttachment.createMany({ data: attachmentRows });
      }

      return tx.task.update({
        where: { id: taskId },
        data: {
          status: 'COMPLETED',
          completionNotes: dto.notes,
          completionTimestamp: new Date(),
        },
        include: { checklistItems: true, attachments: true },
      });
    });
  }

  // Checklist CRUD (admin/manager)
  async addChecklistItem(taskId: string, dto: { label: string }) {
    await this.ensureTaskExists(taskId);
    return this.prisma.taskChecklistItem.create({
      data: { taskId, label: dto.label },
    });
  }

  async updateChecklistItem(taskId: string, itemId: string, dto: { label?: string }) {
    const item = await this.prisma.taskChecklistItem.findUnique({ where: { id: itemId } });
    if (!item || item.taskId !== taskId) throw new NotFoundException('Checklist item not found');
    return this.prisma.taskChecklistItem.update({
      where: { id: itemId },
      data: { label: dto.label ?? undefined },
    });
  }

  async deleteChecklistItem(taskId: string, itemId: string) {
    const item = await this.prisma.taskChecklistItem.findUnique({ where: { id: itemId } });
    if (!item || item.taskId !== taskId) throw new NotFoundException('Checklist item not found');
    await this.prisma.taskChecklistItem.delete({ where: { id: itemId } });
    return { success: true };
  }

  // Attachments
  async addAttachment(
    taskId: string,
    data: { filename: string; mimeType: string; sizeBytes: number; kind: 'PHOTO' | 'FILE' },
    user: RequestUser,
  ) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { assigneeId: true },
    });
    if (!task) throw new NotFoundException('Task not found');
    this.assertCanAccess(task, user);

    const kind: TaskAttachmentKind =
      data.kind === 'PHOTO' ? TaskAttachmentKind.COMPLETION_PHOTO : TaskAttachmentKind.COMPLETION_FILE;
    const url = `/uploads/${data.filename}`;
    return this.prisma.taskAttachment.create({
      data: {
        taskId,
        kind,
        url,
        mimeType: data.mimeType,
        sizeBytes: data.sizeBytes,
      },
    });
  }

  async listAttachmentsForUser(taskId: string, user: RequestUser) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId }, select: { assigneeId: true } });
    if (!task) throw new NotFoundException('Task not found');
    this.assertCanAccess(task, user);
    return this.prisma.taskAttachment.findMany({ where: { taskId }, orderBy: { createdAt: 'desc' } });
  }

  async deleteAttachment(taskId: string, attId: string) {
    const a = await this.prisma.taskAttachment.findUnique({ where: { id: attId } });
    if (!a || a.taskId !== taskId) throw new NotFoundException('Attachment not found');
    await this.prisma.taskAttachment.delete({ where: { id: attId } });
    return { success: true };
  }

  private async ensureTaskExists(id: string) {
    const t = await this.prisma.task.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Task not found');
  }
}
