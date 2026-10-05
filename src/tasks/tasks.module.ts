import { Module } from '@nestjs/common';
import { PrismaModule } from '../database/prisma.module.js';
import { TasksService } from './tasks.service.js';
import { TasksController } from './tasks.controller.js';
import { AuthModule } from '../auth/auth.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [PrismaModule, AuthModule, NotificationsModule],
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
