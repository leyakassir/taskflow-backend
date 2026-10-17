import { Module } from '@nestjs/common';
import { ConfigController } from './config.controller.js';
import { LegalController } from './legal.controller.js';
import { LegalPagesController } from './legal-pages.controller.js';
import { LegalPagesService } from './legal-pages.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { AuditModule } from '../audit/audit.module.js';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [ConfigController, LegalController, LegalPagesController],
  providers: [LegalPagesService],
})
export class ContentModule {}