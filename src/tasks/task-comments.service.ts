import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import type { RequestUser } from '../common/interfaces/authenticated-request.interface.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { TasksService } from './tasks.service.js';
import { CreateTaskCommentDto } from './dto/create-task-comment.dto.js';

const AUTHOR_SELECT = {
  id: true,
  fullName: true,
  role: true,
  avatarUrl: true,
} as const;

@Injectable()
export class TaskCommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tasks: TasksService,
    private readonly notifications: NotificationsService,
  ) {}

  async list(taskId: string, user: RequestUser, page = 1, requestedLimit = 20) {
    await this.tasks.getAccessibleTask(taskId, user);
    const limit = Math.min(requestedLimit, 100);
    const [data, total] = await Promise.all([
      this.prisma.taskComment.findMany({
        where: { taskId },
        skip: (page - 1) * limit,
        take: limit,
        include: { author: { select: AUTHOR_SELECT } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.taskComment.count({ where: { taskId } }),
    ]);
    return { data, page, limit, total, totalPages: Math.ceil(total / limit) };
  }

  async create(taskId: string, dto: CreateTaskCommentDto, user: RequestUser) {
    const task = await this.tasks.getAccessibleTask(taskId, user);
    const comment = await this.prisma.taskComment.create({
      data: { taskId, authorId: user.id, body: dto.body },
      include: { author: { select: AUTHOR_SELECT } },
    });

    // Worker comments go to whoever created the task; admin/manager
    // comments go to the assigned worker.
    const recipientId =
      user.role === UserRole.WORKER ? task.createdById : task.assigneeId;
    await this.notifications.emitComment(task, comment, recipientId);

    return comment;
  }
}
