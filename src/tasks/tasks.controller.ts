import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';

import { TasksService } from './tasks.service.js';
import { CreateTaskDto } from './dto/create-task.dto.js';
import { UpdateTaskDto } from './dto/update-task.dto.js';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto.js';
import { CompleteTaskDto } from './dto/complete-task.dto.js';
import { AssignTaskDto } from './dto/assign-task.dto.js';
import { CreateChecklistItemDto } from './dto/create-checklist-item.dto.js';
import { UpdateChecklistItemDto } from './dto/update-checklist-item.dto.js';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto.js';

import { JwtAuthGuard } from '../auth/jwt.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import type { AuthenticatedRequest } from '../common/interfaces/authenticated-request.interface.js';

@UseGuards(JwtAuthGuard)
@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  // Admin/Manager create and update
  @UseGuards(RolesGuard) @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post()
  create(@Body() dto: CreateTaskDto, @Req() req: AuthenticatedRequest) {
    return this.tasksService.create(dto, req.user);
  }

  @UseGuards(RolesGuard) @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTaskDto, @Req() req: AuthenticatedRequest) {
    return this.tasksService.updateTask(id, dto, req.user);
  }

  // List and read (scoped)
  @Get()
  findAll(@Req() req: AuthenticatedRequest, @Query() query: ListTasksQueryDto) {
    return this.tasksService.findAllForUser(req.user, query.page, query.limit, {
      from: query.from,
      to: query.to,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.tasksService.findOneForUser(id, req.user);
  }

  // Status update and completion
  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateTaskStatusDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.tasksService.updateStatus(id, dto, req.user);
  }

  @Patch(':id/complete')
  complete(
    @Param('id') id: string,
    @Body() dto: CompleteTaskDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.tasksService.complete(id, dto, req.user);
  }

  // Assign / Reassign (admin/manager)
  @UseGuards(RolesGuard) @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Patch(':id/assign')
  assign(@Param('id') id: string, @Body() dto: AssignTaskDto, @Req() req: AuthenticatedRequest) {
    return this.tasksService.assignTask(id, dto.assigneeId, req.user);
  }

  // Checklist CRUD (admin/manager)
  @UseGuards(RolesGuard) @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post(':id/checklist')
  addChecklistItem(@Param('id') id: string, @Body() dto: CreateChecklistItemDto) {
    return this.tasksService.addChecklistItem(id, dto);
  }

  @UseGuards(RolesGuard) @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Patch(':id/checklist/:itemId')
  updateChecklistItem(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateChecklistItemDto,
  ) {
    return this.tasksService.updateChecklistItem(id, itemId, dto);
  }

  @UseGuards(RolesGuard) @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Delete(':id/checklist/:itemId')
  deleteChecklistItem(@Param('id') id: string, @Param('itemId') itemId: string) {
    return this.tasksService.deleteChecklistItem(id, itemId);
  }

  // Attachments
  @Get(':id/attachments')
  listAttachments(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.tasksService.listAttachmentsForUser(id, req.user);
  }

  @UseGuards(RolesGuard) @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Delete(':id/attachments/:attId')
  deleteAttachment(@Param('id') id: string, @Param('attId') attId: string) {
    return this.tasksService.deleteAttachment(id, attId);
  }

  @Post(':id/attachments')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (_req, file, cb) => {
          const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
          const ext = (file.originalname.split('.').pop() || '').toLowerCase();
          cb(null, `${unique}.${ext}`);
        },
      }),
      limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
    }),
  )
  async uploadAttachment(
    @Param('id') id: string,
    @Body('kind') kind: 'PHOTO' | 'FILE',
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    if (kind !== 'PHOTO' && kind !== 'FILE') throw new BadRequestException('Invalid kind');
    return this.tasksService.addAttachment(id, {
      filename: file.filename,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      kind,
    }, req.user);
  }
}
