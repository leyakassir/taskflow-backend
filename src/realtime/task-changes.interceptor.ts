import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, from, mergeMap, tap } from 'rxjs';
import { PrismaService } from '../database/prisma.service.js';
import { RealtimeService } from './realtime.service.js';

/**
 * Announces every successful change to a task or its comments, checklist
 * or attachments, so open apps refresh it immediately. Applied to the task
 * and comment controllers; reads (GET) are ignored.
 *
 * The assignee is looked up before and after the change, so on a
 * reassignment both the previous and the new worker are told (the
 * previous one sees the task disappear).
 */
@Injectable()
export class TaskChangesInterceptor implements NestInterceptor {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request>();
    if (req.method === 'GET') return next.handle();

    const isComment = req.route?.path?.includes('/comments') ?? false;
    const taskId = typeof req.params?.id === 'string' ? req.params.id : undefined;

    return from(this.assigneeOf(taskId)).pipe(
      mergeMap((before) =>
        next.handle().pipe(
          tap({
            next: (body) => {
              void this.announce(taskId ?? idOf(body), before, isComment);
            },
          }),
        ),
      ),
    );
  }

  private async announce(
    taskId: string | undefined,
    before: string | null,
    isComment: boolean,
  ) {
    if (!taskId) return;
    try {
      const after = await this.assigneeOf(taskId);
      if (isComment) {
        this.realtime.publish({ type: 'comment', taskId }, [after], { staff: true });
      }
      // A comment also counts as a task change (e.g. comment counts).
      this.realtime.taskChanged(taskId, [before, after]);
    } catch {
      // Live updates are best effort; the change itself already succeeded.
    }
  }

  private async assigneeOf(taskId: string | undefined): Promise<string | null> {
    if (!taskId) return null;
    const task = await this.prisma.task.findUnique({
      where: { id: taskId },
      select: { assigneeId: true },
    });
    return task?.assigneeId ?? null;
  }
}

/** Task id from a create response (`{ id, ... }`). */
function idOf(body: unknown): string | undefined {
  if (body && typeof body === 'object' && 'id' in body) {
    const id = (body as { id: unknown }).id;
    return typeof id === 'string' ? id : undefined;
  }
  return undefined;
}
