import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { unlink } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { PrismaService } from '../database/prisma.service.js';
import {
  AuditAction,
  Prisma,
  ReviewStatus,
  type Task,
  TaskAttachmentKind,
  TaskPriority,
  TaskStatus,
  UserRole,
} from '@prisma/client';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { UpdateTaskDto } from './dto/update-task.dto.js';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto.js';
import { CompleteTaskDto } from './dto/complete-task.dto.js';
import type { RequestUser } from '../common/interfaces/authenticated-request.interface.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { AuditService, diffFields } from '../audit/audit.service.js';
import { ReviewTaskDto } from './dto/review-task.dto.js';

const ALLOWED_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  ASSIGNED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  OVERDUE: ['IN_PROGRESS', 'CANCELLED'],
  CANCELLED: [],
};

// Task fields the assignee is told about when an admin/manager edits them.
const NOTIFIED_FIELDS: ReadonlyArray<[keyof Task, string]> = [
  ['title', 'title'],
  ['priority', 'priority'],
  ['deadline', 'deadline'],
  ['location', 'location'],
];

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

// Fields an admin can edit; changes to these are written to the audit log.
const TRACKED_TASK_FIELDS = [
  'title',
  'description',
  'titleAr',
  'descriptionAr',
  'priority',
  'deadline',
  'startDate',
  'location',
  'minPhotosRequired',
  'minFilesRequired',
  'requiresChecklist',
] as const;

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
    private readonly audit: AuditService,
  ) {}

  private async ensureAssigneeIsActiveWorker(assigneeId: string) {
    const assignee = await this.prisma.user.findUnique({ where: { id: assigneeId } });
    if (!assignee) throw new BadRequestException('Assignee does not exist');
    if (assignee.role !== UserRole.WORKER || !assignee.isActive) {
      throw new BadRequestException('Assignee must be an active WORKER');
    }
    return assignee;
  }

  private assertCanAccess(task: { assigneeId: string | null }, user: RequestUser) {
    const isOwner = task.assigneeId === user.id;
    const isPrivileged = user.role === UserRole.ADMIN || user.role === UserRole.MANAGER;
    if (!isOwner && !isPrivileged) {
      throw new ForbiddenException('You do not have access to this task');
    }
  }

  async create(dto: CreateTaskDto, createdBy: RequestUser) {
    const assignee = dto.assigneeId ? await this.ensureAssigneeIsActiveWorker(dto.assigneeId) : null;

    const task = await this.prisma.$transaction(async (tx) => {
      const created = await tx.task.create({
        data: {
          title: dto.title,
          description: dto.description,
          titleAr: dto.titleAr,
          descriptionAr: dto.descriptionAr,
          priority: dto.priority as TaskPriority,
          deadline: dto.deadline ? new Date(dto.deadline) : addDays(new Date(), 7),
          startDate: dto.startDate ? new Date(dto.startDate) : undefined,
          location: dto.location,
          minPhotosRequired: dto.minPhotosRequired ?? 0,
          minFilesRequired: dto.minFilesRequired ?? 0,
          requiresChecklist: !!dto.checklistItems?.length,
          assigneeId: dto.assigneeId ?? null,
          createdById: createdBy.id,
          checklistItems: dto.checklistItems
            ? { create: dto.checklistItems.map((c: { label: string }) => ({ label: c.label })) }
            : undefined,
        },
        include: { checklistItems: true, attachments: true },
      });
      await this.audit.record(
        {
          action: AuditAction.TASK_CREATED,
          actorId: createdBy.id,
          taskId: created.id,
          targetUserId: created.assigneeId,
          details: {
            title: created.title,
            assigneeName: assignee?.fullName ?? null,
            priority: created.priority,
            deadline: created.deadline?.toISOString() ?? null,
          },
        },
        tx,
      );
      return created;
    });
    if (task.assigneeId) {
      await this.notifications.emitTaskAssigned(task, task.assigneeId, createdBy.id);
    }
    return task;
  }

  async updateTask(taskId: string, dto: UpdateTaskDto, actor: RequestUser) {
    // Exists?
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Task not found');

    // A new deadline may become overdue again later.
    const deadlineChanged =
      !!dto.deadline && new Date(dto.deadline).getTime() !== task.deadline?.getTime();

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.task.update({
        where: { id: taskId },
        data: {
          title: dto.title ?? undefined,
          description: dto.description ?? undefined,
          titleAr: dto.titleAr ?? undefined,
          descriptionAr: dto.descriptionAr ?? undefined,
          priority: dto.priority ?? undefined,
          deadline: dto.deadline ? new Date(dto.deadline) : undefined,
          startDate: dto.startDate ? new Date(dto.startDate) : undefined,
          location: dto.location ?? undefined,
          minPhotosRequired: typeof dto.minPhotosRequired === 'number' ? dto.minPhotosRequired : undefined,
          minFilesRequired: typeof dto.minFilesRequired === 'number' ? dto.minFilesRequired : undefined,
          requiresChecklist: typeof dto.requiresChecklist === 'boolean' ? dto.requiresChecklist : undefined,
          markedOverdueAt: deadlineChanged ? null : undefined,
        },
        include: { checklistItems: true, attachments: true },
      });
      const changes = diffFields(task, next, [...TRACKED_TASK_FIELDS]);
      if (Object.keys(changes).length > 0) {
        await this.audit.record(
          {
            action: AuditAction.TASK_UPDATED,
            actorId: actor.id,
            taskId,
            details: { title: next.title, changes },
          },
          tx,
        );
      }
      return next;
    });

    const changed = NOTIFIED_FIELDS.filter(([key]) => !sameValue(task[key], updated[key])).map(
      ([key, label]) =>
        key === 'priority' ? `priority (now ${updated.priority.toLowerCase()})` : label,
    );
    const isFinal = updated.status === TaskStatus.COMPLETED || updated.status === TaskStatus.CANCELLED;
    if (changed.length > 0 && !isFinal) {
      await this.notifications.emitTaskUpdated(updated, changed, actor.id);
    }
    return updated;
  }

  async assignTask(taskId: string, assigneeId: string, actor: RequestUser) {
    const assignee = await this.ensureAssigneeIsActiveWorker(assigneeId);
    const t = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: { assignee: { select: { fullName: true } } },
    });
    if (!t) throw new NotFoundException('Task not found');
    if (['COMPLETED', 'CANCELLED'].includes(t.status)) {
      throw new BadRequestException('Cannot reassign a finalized task');
    }
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.task.update({
        where: { id: taskId },
        data: { assigneeId },
        include: { checklistItems: true, attachments: true },
      });
      if (t.assigneeId !== assigneeId) {
        await this.audit.record(
          {
            action: AuditAction.TASK_REASSIGNED,
            actorId: actor.id,
            taskId,
            targetUserId: assigneeId,
            details: {
              title: t.title,
              fromUserId: t.assigneeId,
              fromName: t.assignee?.fullName ?? null,
              toUserId: assigneeId,
              toName: assignee.fullName,
            },
          },
          tx,
        );
      }
      return next;
    });
    // Re-assigning to the same worker is not a new event.
    if (t.assigneeId !== assigneeId) {
      await this.notifications.emitTaskAssigned(updated, assigneeId, actor.id, !!t.assigneeId);
      if (t.assigneeId) {
        await this.notifications.emitTaskUnassigned(updated, t.assigneeId, actor.id);
      }
    }
    return updated;
  }

  async findAllForUser(
    user: RequestUser,
    page = 1,
    requestedLimit = 20,
    range?: { from?: string; to?: string },
  ) {
    const scope: Prisma.TaskWhereInput =
      user.role === UserRole.WORKER ? { assigneeId: user.id } : {};
    const where: Prisma.TaskWhereInput = { AND: [scope, this.dateRangeFilter(range)] };
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

  // Matches tasks whose deadline or startDate falls inside the range.
  // Either bound may be omitted; no bounds means no filter.
  private dateRangeFilter(range?: { from?: string; to?: string }): Prisma.TaskWhereInput {
    if (!range?.from && !range?.to) return {};
    const from = range.from ? new Date(range.from) : undefined;
    const to = range.to ? new Date(range.to) : undefined;
    if (from && to && from > to) {
      throw new BadRequestException('"from" must be before or equal to "to"');
    }
    const bounds = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
    return { OR: [{ deadline: bounds }, { startDate: bounds }] };
  }

  /** Loads the fields task-scoped features need, after the access check. */
  async getAccessibleTask(taskId: string, user: RequestUser) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { id: true, title: true, status: true, assigneeId: true, createdById: true },
    });
    if (!task) throw new NotFoundException('Task not found');
    this.assertCanAccess(task, user);
    return task;
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
    // Completing here still counts as a submission, so it goes to review.
    const submitted = dto.status === TaskStatus.COMPLETED;
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.task.update({
        where: { id: taskId },
        data: {
          status: dto.status,
          ...(submitted ? { reviewStatus: ReviewStatus.PENDING, reviewNote: null } : {}),
        },
      });
      const action = submitted
        ? AuditAction.TASK_SUBMITTED
        : dto.status === TaskStatus.CANCELLED
          ? AuditAction.TASK_CANCELLED
          : dto.status === TaskStatus.IN_PROGRESS && task.status === TaskStatus.ASSIGNED
            ? AuditAction.TASK_STARTED
            : AuditAction.TASK_STATUS_CHANGED;
      await this.audit.record(
        {
          action,
          actorId: user.id,
          taskId,
          details: { title: task.title, from: task.status, to: dto.status },
        },
        tx,
      );
      return next;
    });
    if (updated.status === TaskStatus.CANCELLED) {
      await this.notifications.emitTaskCancelled(updated, user.id);
    } else if (updated.status === TaskStatus.COMPLETED) {
      await this.notifications.emitTaskSubmitted(
        updated,
        user.id,
        task.reviewStatus === ReviewStatus.CHANGES_REQUESTED ? updated.updatedAt : undefined,
      );
    }
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

    const completed = await this.prisma.$transaction(async (tx) => {
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

      const submittedAt = new Date();
      const completed = await tx.task.update({
        where: { id: taskId },
        data: {
          status: 'COMPLETED',
          completionNotes: dto.notes,
          completionTimestamp: submittedAt,
          reviewStatus: ReviewStatus.PENDING,
          reviewNote: null,
        },
        include: { checklistItems: true, attachments: true },
      });
      await this.audit.record(
        {
          action: AuditAction.TASK_SUBMITTED,
          actorId: user.id,
          taskId,
          details: {
            title: task.title,
            onTime: task.deadline ? submittedAt <= task.deadline : null,
            photos: dto.photos?.length ?? 0,
            files: dto.files?.length ?? 0,
            resubmission: task.reviewStatus === ReviewStatus.CHANGES_REQUESTED,
          },
        },
        tx,
      );
      return completed;
    });
    await this.notifications.emitTaskSubmitted(
      completed,
      user.id,
      task.reviewStatus === ReviewStatus.CHANGES_REQUESTED ? completed.completionTimestamp : undefined,
    );
    return completed;
  }

  // Review (admin/manager): approve, or send back with a note
  async review(taskId: string, dto: ReviewTaskDto, actor: RequestUser) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new NotFoundException('Task not found');
    if (task.status !== TaskStatus.COMPLETED || task.reviewStatus !== ReviewStatus.PENDING) {
      throw new BadRequestException('Only submitted tasks waiting for review can be reviewed');
    }

    const approve = dto.decision === 'APPROVE';
    const note = dto.note?.trim() || null;
    if (!approve && (!note || note.length < 3)) {
      throw new BadRequestException('Add a note telling the worker what to fix');
    }
    if (approve && dto.assigneeId) {
      throw new BadRequestException('A different worker can only be chosen when sending a task back');
    }
    const newAssignee =
      !approve && dto.assigneeId && dto.assigneeId !== task.assigneeId
        ? await this.ensureAssigneeIsActiveWorker(dto.assigneeId)
        : null;
    const previous =
      newAssignee && task.assigneeId
        ? await this.prisma.user.findUnique({ where: { id: task.assigneeId }, select: { fullName: true } })
        : null;

    const reviewed = await this.prisma.$transaction(async (tx) => {
      const decided = { reviewNote: note, reviewedAt: new Date(), reviewedById: actor.id };
      // Only matches while pending, so two reviewers can't both decide.
      const result = await tx.task.updateMany({
        where: { id: taskId, status: TaskStatus.COMPLETED, reviewStatus: ReviewStatus.PENDING },
        data: approve
          ? { ...decided, reviewStatus: ReviewStatus.APPROVED }
          : {
              ...decided,
              reviewStatus: ReviewStatus.CHANGES_REQUESTED,
              // Back to the same worker to fix; a different worker gets it as a fresh assignment.
              status: newAssignee ? TaskStatus.ASSIGNED : TaskStatus.IN_PROGRESS,
              completionTimestamp: null,
              ...(newAssignee ? { assigneeId: newAssignee.id } : {}),
            },
      });
      if (result.count !== 1) throw new ConflictException('This submission was already reviewed');
      if (newAssignee) {
        // New worker starts with an unticked checklist.
        await tx.taskChecklistItem.updateMany({ where: { taskId }, data: { done: false } });
      }

      await this.audit.record(
        {
          action: approve ? AuditAction.TASK_APPROVED : AuditAction.TASK_SENT_BACK,
          actorId: actor.id,
          taskId,
          targetUserId: newAssignee?.id ?? task.assigneeId,
          details: newAssignee
            ? {
                title: task.title,
                note,
                fromUserId: task.assigneeId,
                fromName: previous?.fullName ?? null,
                toUserId: newAssignee.id,
                toName: newAssignee.fullName,
              }
            : { title: task.title, note },
        },
        tx,
      );
      return tx.task.findUniqueOrThrow({
        where: { id: taskId },
        include: { checklistItems: true, attachments: true },
      });
    });

    if (newAssignee) {
      await this.notifications.emitTaskSentBack(reviewed, newAssignee.id, note, actor.id, true);
      if (task.assigneeId) {
        await this.notifications.emitTaskUnassigned(reviewed, task.assigneeId, actor.id);
      }
    } else if (approve) {
      await this.notifications.emitTaskApproved(reviewed, note, actor.id);
    } else {
      await this.notifications.emitTaskSentBack(reviewed, reviewed.assigneeId, note, actor.id);
    }
    return reviewed;
  }

  // Delete (admin/manager): checklist, attachments and comments cascade; notifications and audit entries stay unlinked.
  async deleteTask(taskId: string, actor: RequestUser) {
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        attachments: { select: { url: true } },
        assignee: { select: { fullName: true } },
        _count: { select: { comments: true, checklistItems: true } },
      },
    });
    if (!task) throw new NotFoundException('Task not found');

    await this.prisma.$transaction(async (tx) => {
      await this.audit.record(
        {
          action: AuditAction.TASK_DELETED,
          actorId: actor.id,
          targetUserId: task.assigneeId,
          details: {
            title: task.title,
            deletedTaskId: task.id,
            status: task.status,
            assigneeName: task.assignee?.fullName ?? null,
            attachments: task.attachments.length,
            comments: task._count.comments,
            checklistItems: task._count.checklistItems,
          },
        },
        tx,
      );
      await tx.task.delete({ where: { id: taskId } });
    });

    const stillOpen: TaskStatus[] = [TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS, TaskStatus.OVERDUE];
    if (stillOpen.includes(task.status)) {
      await this.notifications.emitTaskDeleted(task, task.assigneeId, actor.id);
    }

    // Remove the uploaded files too (basename only, so a stored url can't point outside uploads/).
    await Promise.all(
      task.attachments
        .filter((a) => a.url.startsWith('/uploads/'))
        .map((a) => unlink(join(process.cwd(), 'uploads', basename(a.url))).catch(() => undefined)),
    );
    return { success: true };
  }

  // Checklist CRUD (admin/manager)
  async addChecklistItem(taskId: string, dto: { label: string }, actor: RequestUser) {
    const task = await this.ensureTaskExists(taskId);
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.taskChecklistItem.create({
        data: { taskId, label: dto.label },
      });
      await this.audit.record(
        {
          action: AuditAction.CHECKLIST_ITEM_ADDED,
          actorId: actor.id,
          taskId,
          details: { title: task.title, label: item.label },
        },
        tx,
      );
      return item;
    });
  }

  async updateChecklistItem(taskId: string, itemId: string, dto: { label?: string }, actor: RequestUser) {
    const item = await this.prisma.taskChecklistItem.findUnique({
      where: { id: itemId },
      include: { task: { select: { title: true } } },
    });
    if (!item || item.taskId !== taskId) throw new NotFoundException('Checklist item not found');
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.taskChecklistItem.update({
        where: { id: itemId },
        data: { label: dto.label ?? undefined },
      });
      if (updated.label !== item.label) {
        await this.audit.record(
          {
            action: AuditAction.CHECKLIST_ITEM_RENAMED,
            actorId: actor.id,
            taskId,
            details: { title: item.task.title, from: item.label, to: updated.label },
          },
          tx,
        );
      }
      return updated;
    });
  }

  async deleteChecklistItem(taskId: string, itemId: string, actor: RequestUser) {
    const item = await this.prisma.taskChecklistItem.findUnique({
      where: { id: itemId },
      include: { task: { select: { title: true } } },
    });
    if (!item || item.taskId !== taskId) throw new NotFoundException('Checklist item not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.taskChecklistItem.delete({ where: { id: itemId } });
      await this.audit.record(
        {
          action: AuditAction.CHECKLIST_ITEM_REMOVED,
          actorId: actor.id,
          taskId,
          details: { title: item.task.title, label: item.label },
        },
        tx,
      );
    });
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
      select: { assigneeId: true, title: true },
    });
    if (!task) throw new NotFoundException('Task not found');
    this.assertCanAccess(task, user);

    const kind: TaskAttachmentKind =
      data.kind === 'PHOTO' ? TaskAttachmentKind.COMPLETION_PHOTO : TaskAttachmentKind.COMPLETION_FILE;
    const url = `/uploads/${data.filename}`;
    return this.prisma.$transaction(async (tx) => {
      const attachment = await tx.taskAttachment.create({
        data: {
          taskId,
          kind,
          url,
          mimeType: data.mimeType,
          sizeBytes: data.sizeBytes,
        },
      });
      await this.audit.record(
        {
          action: AuditAction.ATTACHMENT_UPLOADED,
          actorId: user.id,
          taskId,
          details: { title: task.title, kind, mimeType: data.mimeType, url },
        },
        tx,
      );
      return attachment;
    });
  }

  async listAttachmentsForUser(taskId: string, user: RequestUser) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId }, select: { assigneeId: true } });
    if (!task) throw new NotFoundException('Task not found');
    this.assertCanAccess(task, user);
    return this.prisma.taskAttachment.findMany({ where: { taskId }, orderBy: { createdAt: 'desc' } });
  }

  async deleteAttachment(taskId: string, attId: string, actor: RequestUser) {
    const a = await this.prisma.taskAttachment.findUnique({
      where: { id: attId },
      include: { task: { select: { title: true } } },
    });
    if (!a || a.taskId !== taskId) throw new NotFoundException('Attachment not found');
    await this.prisma.$transaction(async (tx) => {
      await tx.taskAttachment.delete({ where: { id: attId } });
      await this.audit.record(
        {
          action: AuditAction.ATTACHMENT_REMOVED,
          actorId: actor.id,
          taskId,
          details: { title: a.task.title, kind: a.kind, url: a.url },
        },
        tx,
      );
    });
    return { success: true };
  }

  private async ensureTaskExists(id: string) {
    const t = await this.prisma.task.findUnique({ where: { id } });
    if (!t) throw new NotFoundException('Task not found');
    return t;
  }
}
