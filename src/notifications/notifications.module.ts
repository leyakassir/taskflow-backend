import { Module } from '@nestjs/common';
import { PrismaModule } from '../database/prisma.module.js';
import { NotificationsService } from './notifications.service.js';

@Module({
  imports: [PrismaModule],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
