import { Controller, type MessageEvent, Req, Sse, UseGuards } from '@nestjs/common';
import { Observable, interval, map, merge } from 'rxjs';
import { JwtAuthGuard } from '../auth/jwt.guard.js';
import type { AuthenticatedRequest } from '../common/interfaces/authenticated-request.interface.js';
import { RealtimeService } from './realtime.service.js';

/** Keeps idle connections open through proxies and lets clients notice drops. */
const HEARTBEAT_MS = 25_000;

@UseGuards(JwtAuthGuard)
@Controller()
export class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  /**
   * Server-Sent Events stream of change notices for the signed-in user:
   * `data: {"type":"task","taskId":"..."}`. A `{"type":"ping"}` heartbeat
   * is sent every 25 s.
   */
  @Sse('events')
  events(@Req() req: AuthenticatedRequest): Observable<MessageEvent> {
    const heartbeat = interval(HEARTBEAT_MS).pipe(map(() => ({ type: 'ping' })));
    return merge(this.realtime.streamFor(req.user), heartbeat).pipe(
      map((data) => ({ data })),
    );
  }
}
