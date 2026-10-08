import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module.js';
import { PrismaModule } from '../database/prisma.module.js';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsService } from './notifications.service.js';
import { PushNotificationsService } from './push-notifications.service.js';
import { RemindersService } from './reminders.service.js';

@Module({
  imports: [AuthModule, ConfigModule, PrismaModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, PushNotificationsService, RemindersService],
  exports: [NotificationsService, PushNotificationsService],
})
export class NotificationsModule {}
