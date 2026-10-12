import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { RealtimeController } from './realtime.controller.js';
import { RealtimeService } from './realtime.service.js';
import { TaskChangesInterceptor } from './task-changes.interceptor.js';

/** Live updates over Server-Sent Events (GET /events). */
@Global()
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [RealtimeController],
  providers: [RealtimeService, TaskChangesInterceptor],
  exports: [RealtimeService, TaskChangesInterceptor],
})
export class RealtimeModule {}
