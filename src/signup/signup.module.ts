import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { SignupRequestsController } from './signup-requests.controller.js';
import { SignupRequestsService } from './signup-requests.service.js';

/** "Request an account" with email verification and admin review. */
@Module({
  imports: [NotificationsModule, AuditModule],
  controllers: [SignupRequestsController],
  providers: [SignupRequestsService],
})
export class SignupModule {}
