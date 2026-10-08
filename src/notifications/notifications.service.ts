import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma, type Notification, NotificationKind, type Task, TaskStatus } from '@prisma/client';
import { PrismaService } from '../database/prisma.service.js';
import { PushNotificationsService } from './push-notifications.service.js';

export type NotifyInput = {
  /** Recipient. Nothing is sent when absent. */
  userId: string | null | undefined;
  kind: NotificationKind;
  title: string;
  body: string;
  /** Identifies the event; one notification per (userId, dedupeKey). */
  dedupeKey: string;
  taskId?: string;
  /** The user who caused the event. They are never notified about it. */
  actorId?: string;
};

type TaskSummary = Pick<Task, 'id' | 'title'>;

export type OverdueTask = TaskSummary &
  Pick<Task, 'deadline' | 'assigneeId' | 'createdById'> & {
    assignee: { fullName: string } | null;
  };

const COMMENT_PREVIEW_LENGTH = 140;

function isFinished(status: TaskStatus): boolean {
  return status === TaskStatus.COMPLETED || status === TaskStatus.CANCELLED;
}

/** "a", "a and b", "a, b and c". */
function joinList(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function plural(count: number, unit: string): string {
  return `${count} ${unit}${count === 1 ? '' : 's'}`;
}

/** "23 hours", "1 hour 30 minutes", "45 minutes". */
function formatTimeRemaining(ms: number): string {
  const totalMinutes = Math.max(1, Math.round(ms / 60_000));
  if (totalMinutes < 60) return plural(totalMinutes, 'minute');
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  // Minutes matter close to the deadline; further out, whole hours read better.
  if (hours >= 3 || minutes === 0) return plural(Math.round(totalMinutes / 60), 'hour');
  return `${plural(hours, 'hour')} ${plural(minutes, 'minute')}`;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pushNotifications: PushNotificationsService,
  ) {}

  /**
   * Stores an in-app notification and sends a push, at most once per
   * (userId, dedupeKey). Skips the actor and inactive users. Never throws:
   * a notification failure must not fail the request that triggered it.
   */
  async notify(input: NotifyInput): Promise<Omit<Notification, 'dedupeKey'> | null> {
    const { userId, dedupeKey } = input;
    if (!userId || userId === input.actorId) return null;

    try {
      const recipient = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { isActive: true },
      });
      if (!recipient?.isActive) return null;

      const existing = await this.prisma.notification.findUnique({
        where: { userId_dedupeKey: { userId, dedupeKey } },
        select: { id: true },
      });
      if (existing) return null;

      const notification = await this.prisma.notification.create({
        data: {
          userId,
          kind: input.kind,
          taskId: input.taskId,
          title: input.title,
          body: input.body,
          dedupeKey,
        },
        omit: { dedupeKey: true },
      });

      await this.pushNotifications.sendToUser(userId, {
        title: notification.title,
        body: notification.body,
        data: {
          notificationId: notification.id,
          kind: notification.kind,
          ...(input.taskId ? { taskId: input.taskId } : {}),
        },
      });
      return notification;
    } catch (error) {
      // Lost a race with a concurrent insert for the same event.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return null;
      }
      this.logger.error(`Failed to notify user ${userId} (${dedupeKey})`, error);
      return null;
    }
  }

  /**
   * To the new assignee. [reassigned] is true when the task moved from
   * another worker, so the worker can tell it is not a brand-new task.
   */
  emitTaskAssigned(
    task: TaskSummary & Pick<Task, 'updatedAt'>,
    assigneeId: string,
    actorId?: string,
    reassigned = false,
  ) {
    return this.notify({
      userId: assigneeId,
      actorId,
      kind: reassigned ? NotificationKind.TASK_REASSIGNED : NotificationKind.TASK_ASSIGNED,
      taskId: task.id,
      title: reassigned ? 'Task reassigned to you' : 'New task assigned',
      body: reassigned ? `"${task.title}" was reassigned to you.` : task.title,
      // A task can be assigned to the same worker again later; each
      // assignment is its own event.
      dedupeKey: `assigned:${task.id}:${task.updatedAt.getTime()}`,
    });
  }

  /**
   * One deadline reminder. The dedupe key includes the deadline, so moving
   * the deadline allows fresh reminders for the new date.
   */
  async emitDeadlineReminder(
    task: Pick<Task, 'id' | 'title' | 'deadline' | 'assigneeId'>,
    reminderKey: string,
    now: Date,
  ) {
    if (!task.deadline || !task.assigneeId) return null;
    const remaining = formatTimeRemaining(task.deadline.getTime() - now.getTime());
    return this.notify({
      userId: task.assigneeId,
      kind: NotificationKind.TASK_DUE_SOON,
      taskId: task.id,
      title: `Due in ${remaining}: ${task.title}`,
      body: `Your task "${task.title}" is due in ${remaining}.`,
      dedupeKey: `${reminderKey}:${task.id}:${task.deadline.getTime()}`,
    });
  }

  /** Previous assignee: the task was taken off their list. */
  emitTaskUnassigned(task: TaskSummary & Pick<Task, 'updatedAt'>, previousAssigneeId: string, actorId?: string) {
    return this.notify({
      userId: previousAssigneeId,
      actorId,
      kind: NotificationKind.TASK_UNASSIGNED,
      taskId: task.id,
      title: 'Task reassigned',
      body: `"${task.title}" was reassigned and is no longer on your list.`,
      dedupeKey: `unassigned:${task.id}:${task.updatedAt.getTime()}`,
    });
  }

  emitTaskCancelled(task: TaskSummary & Pick<Task, 'assigneeId'>, actorId?: string) {
    return this.notify({
      userId: task.assigneeId,
      actorId,
      kind: NotificationKind.TASK_CANCELLED,
      taskId: task.id,
      title: 'Task cancelled',
      body: `"${task.title}" was cancelled.`,
      // CANCELLED is final, so this can only happen once per task.
      dedupeKey: `cancelled:${task.id}`,
    });
  }

  /** Only call when at least one field really changed. */
  emitTaskUpdated(
    task: TaskSummary & Pick<Task, 'assigneeId' | 'updatedAt'>,
    changedFields: string[],
    actorId?: string,
  ) {
    return this.notify({
      userId: task.assigneeId,
      actorId,
      kind: NotificationKind.TASK_UPDATED,
      taskId: task.id,
      title: 'Task updated',
      body: `"${task.title}": ${joinList(changedFields)} changed.`,
      dedupeKey: `updated:${task.id}:${task.updatedAt.getTime()}`,
    });
  }

  /** To the task's creator when the worker submits completion. */
  emitTaskSubmitted(task: TaskSummary & Pick<Task, 'createdById'>, actorId?: string) {
    return this.notify({
      userId: task.createdById,
      actorId,
      kind: NotificationKind.TASK_SUBMITTED,
      taskId: task.id,
      title: 'Task completed',
      body: `"${task.title}" was submitted as completed.`,
      // COMPLETED is final, so this can only happen once per task.
      dedupeKey: `submitted:${task.id}`,
    });
  }

  /**
   * Sent once when the job marks a task OVERDUE: to the assignee and to the
   * task's creator. Keyed by deadline, matching the reminders.
   */
  async emitOverdue(task: OverdueTask) {
    if (!task.deadline) return;
    const dedupeKey = `overdue:${task.id}:${task.deadline.getTime()}`;
    await this.notify({
      userId: task.assigneeId,
      kind: NotificationKind.TASK_OVERDUE,
      taskId: task.id,
      title: 'Task overdue',
      body: `"${task.title}" passed its deadline and is now overdue.`,
      dedupeKey,
    });
    await this.notify({
      userId: task.createdById,
      kind: NotificationKind.TASK_OVERDUE,
      taskId: task.id,
      title: 'Task overdue',
      body: task.assignee
        ? `"${task.title}" (assigned to ${task.assignee.fullName}) is overdue.`
        : `"${task.title}" is overdue and has no assignee.`,
      dedupeKey,
    });
  }

  /** Not sent for finished (COMPLETED/CANCELLED) tasks. */
  async emitComment(
    task: TaskSummary & Pick<Task, 'status'>,
    comment: { id: string; body: string; author: { id: string; fullName: string } },
    recipientId: string | null,
  ) {
    if (isFinished(task.status)) return null;
    const preview =
      comment.body.length > COMMENT_PREVIEW_LENGTH
        ? `${comment.body.slice(0, COMMENT_PREVIEW_LENGTH - 1)}…`
        : comment.body;
    return this.notify({
      userId: recipientId,
      actorId: comment.author.id,
      kind: NotificationKind.TASK_COMMENT,
      taskId: task.id,
      title: `New comment on "${task.title}"`,
      body: `${comment.author.fullName}: ${preview}`,
      dedupeKey: `comment:${comment.id}`,
    });
  }

  /**
   * Morning summary for one worker. Has no taskId; the app opens the
   * calendar. Once per user per day (dateKey is YYYY-MM-DD).
   */
  emitDailySummary(userId: string, dueTodayCount: number, dateKey: string) {
    if (dueTodayCount <= 0) return Promise.resolve(null);
    return this.notify({
      userId,
      kind: NotificationKind.DAILY_SUMMARY,
      title: 'Your day ahead',
      body:
        dueTodayCount === 1
          ? 'You have 1 task due today.'
          : `You have ${dueTodayCount} tasks due today.`,
      dedupeKey: `daily-summary:${dateKey}`,
    });
  }

  list(userId: string, unreadOnly = false) {
    return this.prisma.notification.findMany({
      where: { userId, ...(unreadOnly ? { readAt: null } : {}) },
      orderBy: { createdAt: 'desc' },
      omit: { dedupeKey: true },
    });
  }

  async markRead(userId: string, id: string) {
    const notification = await this.prisma.notification.findFirst({
      where: { id, userId },
      omit: { dedupeKey: true },
    });
    if (!notification) throw new NotFoundException('Notification not found');
    if (notification.readAt) return notification;

    return this.prisma.notification.update({
      where: { id },
      data: { readAt: new Date() },
      omit: { dedupeKey: true },
    });
  }

  async markAllRead(userId: string) {
    const { count } = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { updated: count };
  }
}
