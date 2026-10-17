import { Injectable } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Observable, Subject, filter, map } from 'rxjs';

/** What changed. Clients refetch the matching data; no data is sent. */
export type RealtimeEventType = 'task' | 'comment' | 'notification' | 'signup';

export interface RealtimeEvent {
  type: RealtimeEventType;
  taskId?: string;
}

interface Envelope {
  event: RealtimeEvent;
  /** Users who should receive it. */
  userIds: ReadonlySet<string>;
  /** Also send to every ADMIN and MANAGER. */
  staff: boolean;
}

/**
 * In-process event bus for live updates (Server-Sent Events). Events only
 * say *what* changed (a task id); clients reload it through the normal,
 * access-checked endpoints, so nothing private is ever broadcast.
 *
 * Single-process only: with several backend instances behind a load
 * balancer this would need a shared bus (e.g. Redis pub/sub).
 */
@Injectable()
export class RealtimeService {
  private readonly bus = new Subject<Envelope>();

  publish(
    event: RealtimeEvent,
    userIds: Iterable<string | null | undefined>,
    { staff = false }: { staff?: boolean } = {},
  ) {
    const ids = new Set<string>();
    for (const id of userIds) if (id) ids.add(id);
    if (ids.size === 0 && !staff) return;
    this.bus.next({ event, userIds: ids, staff });
  }

  /** A task changed: its assignees (old and new) and all staff hear it. */
  taskChanged(taskId: string, assigneeIds: Iterable<string | null | undefined>) {
    this.publish({ type: 'task', taskId }, assigneeIds, { staff: true });
  }

  /** Events visible to one connected user. */
  streamFor(user: { id: string; role: UserRole }): Observable<RealtimeEvent> {
    const isStaff = user.role === UserRole.ADMIN || user.role === UserRole.MANAGER;
    return this.bus.pipe(
      filter((e) => e.userIds.has(user.id) || (e.staff && isStaff)),
      map((e) => e.event),
    );
  }
}
