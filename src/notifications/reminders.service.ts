import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, TaskStatus } from '@prisma/client';
import { CronJob } from 'cron';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PrismaService } from '../database/prisma.service.js';
import { NotificationsService, type OverdueTask } from './notifications.service.js';

const HOUR_MS = 60 * 60 * 1000;

/** First deadline reminder: about this long before the deadline. */
export const FIRST_DEADLINE_REMINDER_MS = 24 * HOUR_MS;
/** Second deadline reminder: about this long before the deadline. */
export const SECOND_DEADLINE_REMINDER_MS = 2 * HOUR_MS;
/**
 * Morning "N tasks due today" summary: sent on the first job run at or after
 * this hour (server local time)...
 */
export const DAILY_SUMMARY_HOUR = 8;
/** ...and not after this hour, so a task assigned in the afternoon does not trigger a "morning" summary. */
export const DAILY_SUMMARY_LAST_HOUR = 12;
/** How often the job runs, unless REMINDER_CRON overrides it. */
export const DEFAULT_REMINDER_CRON = '*/5 * * * *';

/**
 * Largest lead time first. Each reminder's window runs from its lead time
 * down to the next one's, so a task is in at most one window at a time.
 * The key is part of the dedupe key, together with the task id and the
 * deadline, so each reminder is sent once per deadline.
 */
const DEADLINE_REMINDERS = [
  { key: 'due-24h', leadMs: FIRST_DEADLINE_REMINDER_MS },
  { key: 'due-2h', leadMs: SECOND_DEADLINE_REMINDER_MS },
] as const;

const ACTIVE_STATUSES = [TaskStatus.ASSIGNED, TaskStatus.IN_PROGRESS];
const BATCH_SIZE = 100;

const CANDIDATE_SELECT = {
  id: true,
  title: true,
  deadline: true,
  assigneeId: true,
  createdById: true,
  assignee: { select: { fullName: true } },
} as const;

@Injectable()
export class RemindersService implements OnModuleInit {
  private readonly logger = new Logger(RemindersService.name);
  private readonly cronJobName = 'task-notification-reminders';

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly config: ConfigService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit() {
    const cronExpression =
      this.config.get<string>('REMINDER_CRON') ?? DEFAULT_REMINDER_CRON;
    const job = CronJob.from({
      cronTime: cronExpression,
      onTick: () => {
        void this.runReminders().catch((error: unknown) => {
          this.logger.error('Failed to process task reminders', error);
        });
      },
    });
    this.scheduler.addCronJob(this.cronJobName, job);
    job.start();
  }

  async runReminders(now = new Date()) {
    await this.sendDeadlineReminders(now);
    await this.markOverdueTasks(now);
    await this.sendDailySummaries(now);
  }

  /**
   * Once per worker per day, inside the morning window: how many unfinished
   * tasks are due today. Workers with none get nothing.
   */
  private async sendDailySummaries(now: Date) {
    const hour = now.getHours();
    if (hour < DAILY_SUMMARY_HOUR || hour >= DAILY_SUMMARY_LAST_HOUR) return;

    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const dateKey = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, '0'),
      String(now.getDate()).padStart(2, '0'),
    ].join('-');

    const counts = await this.prisma.task.groupBy({
      by: ['assigneeId'],
      where: {
        status: { in: [...ACTIVE_STATUSES, TaskStatus.OVERDUE] },
        assigneeId: { not: null },
        assignee: { isActive: true },
        deadline: { gte: startOfDay, lt: endOfDay },
      },
      _count: { _all: true },
    });
    for (const row of counts) {
      if (row.assigneeId) {
        await this.notifications.emitDailySummary(row.assigneeId, row._count._all, dateKey);
      }
    }
  }

  /**
   * Moves ASSIGNED/IN_PROGRESS tasks past their deadline to OVERDUE and
   * notifies the worker and the creator. Each task is marked once per
   * deadline (see Task.markedOverdueAt), so a worker can still restart an
   * overdue task (OVERDUE -> IN_PROGRESS) without the job flipping it back.
   */
  private async markOverdueTasks(now: Date) {
    const where: Prisma.TaskWhereInput = {
      status: { in: ACTIVE_STATUSES },
      deadline: { lt: now },
      markedOverdueAt: null,
    };
    await this.processCandidates(where, async (task) => {
      // Conditional update so overlapping runs cannot both claim a task.
      const { count } = await this.prisma.task.updateMany({
        where: { ...where, id: task.id },
        data: { status: TaskStatus.OVERDUE, markedOverdueAt: now },
      });
      if (count === 1) await this.notifications.emitOverdue(task);
    });
  }

  /**
   * Sends the 24h and 2h reminders for active tasks with an active assignee.
   * Tasks without a deadline, finished tasks and inactive users never match.
   */
  private async sendDeadlineReminders(now: Date) {
    for (const [index, reminder] of DEADLINE_REMINDERS.entries()) {
      const windowEndMs = DEADLINE_REMINDERS[index + 1]?.leadMs ?? 0;
      await this.processCandidates(
        {
          status: { in: ACTIVE_STATUSES },
          assignee: { isActive: true },
          deadline: {
            gt: new Date(now.getTime() + windowEndMs),
            lte: new Date(now.getTime() + reminder.leadMs),
          },
        },
        (task) =>
          this.notifications.emitDeadlineReminder(task, reminder.key, now),
      );
    }
  }

  private async processCandidates(
    where: Prisma.TaskWhereInput,
    emit: (task: OverdueTask) => Promise<unknown>,
  ) {
    let lastId: string | undefined;

    while (true) {
      const tasks = await this.prisma.task.findMany({
        where: { ...where, ...(lastId ? { id: { gt: lastId } } : {}) },
        select: CANDIDATE_SELECT,
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
      });
      if (tasks.length === 0) return;

      await Promise.all(tasks.map(emit));
      lastId = tasks[tasks.length - 1]!.id;
    }
  }
}
