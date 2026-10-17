import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { JobRolesController } from './job-roles.controller.js';
import { JobRolesService } from './job-roles.service.js';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [JobRolesController],
  providers: [JobRolesService],
})
export class JobRolesModule {}
