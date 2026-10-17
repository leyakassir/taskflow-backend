import {
  Body,
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseBoolPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { UsersService } from './users.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import { UpdatePasswordDto } from './dto/update-password.dto.js';
import { SetUserActiveDto } from './dto/set-user-active.dto.js';
import { JwtAuthGuard } from '../auth/jwt.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import type { AuthenticatedRequest } from '../common/interfaces/authenticated-request.interface.js';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MANAGER)
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  create(@Body() dto: CreateUserDto, @Req() req: AuthenticatedRequest) {
    return this.users.create(dto, req.user);
  }

  @Get()
  findAll(
    @Query('role') role?: UserRole,
    @Query('isActive', new DefaultValuePipe('true'), ParseBoolPipe) isActive?: boolean,
    @Query('q') search?: string,
  ) {
    return this.users.findAll({ role, isActive, search });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.users.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @Req() req: AuthenticatedRequest) {
    return this.users.update(id, dto, req.user);
  }

  @Patch(':id/password')
  updatePassword(
    @Param('id') id: string,
    @Body() dto: UpdatePasswordDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.users.updatePassword(id, dto, req.user);
  }

  @Patch(':id/active')
  setActive(@Param('id') id: string, @Body() dto: SetUserActiveDto, @Req() req: AuthenticatedRequest) {
    return this.users.setActive(id, dto.isActive, req.user);
  }
}
