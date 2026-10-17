import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import type { AuthenticatedRequest } from '../common/interfaces/authenticated-request.interface.js';
import { CreateJobRoleDto } from './dto/create-job-role.dto.js';
import { UpdateJobRoleDto } from './dto/update-job-role.dto.js';
import { JobRolesService } from './job-roles.service.js';

// Company-specific roles ("IT support", "Cashier"...) shown on accounts instead of the built-in names.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MANAGER)
@Controller('job-roles')
export class JobRolesController {
  constructor(private readonly roles: JobRolesService) {}

  @Get()
  list() {
    return this.roles.list();
  }

  @Post()
  create(@Body() dto: CreateJobRoleDto, @Req() req: AuthenticatedRequest) {
    return this.roles.create(dto, req.user);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateJobRoleDto, @Req() req: AuthenticatedRequest) {
    return this.roles.update(id, dto, req.user);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.roles.remove(id, req.user);
  }
}
