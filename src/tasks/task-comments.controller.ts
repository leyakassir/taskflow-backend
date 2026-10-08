import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard.js';
import type { AuthenticatedRequest } from '../common/interfaces/authenticated-request.interface.js';
import { CreateTaskCommentDto } from './dto/create-task-comment.dto.js';
import { ListTaskCommentsQueryDto } from './dto/list-task-comments-query.dto.js';
import { TaskCommentsService } from './task-comments.service.js';

// Access: the assigned worker, or any ADMIN/MANAGER (same check as GET /tasks/:id).
@ApiTags('task comments')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('tasks/:id/comments')
export class TaskCommentsController {
  constructor(private readonly comments: TaskCommentsService) {}

  @Get()
  @ApiOperation({ summary: 'List comments on a task, oldest first (paginated)' })
  @ApiParam({ name: 'id', description: 'Task ID' })
  @ApiOkResponse({ description: '{ data, page, limit, total, totalPages }' })
  @ApiForbiddenResponse({ description: 'Worker is not assigned to this task' })
  @ApiNotFoundResponse({ description: 'Task not found' })
  list(
    @Param('id') id: string,
    @Query() query: ListTaskCommentsQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.comments.list(id, req.user, query.page, query.limit);
  }

  @Post()
  @ApiOperation({ summary: 'Add a comment to a task' })
  @ApiParam({ name: 'id', description: 'Task ID' })
  @ApiCreatedResponse({ description: 'The created comment with its author' })
  @ApiForbiddenResponse({ description: 'Worker is not assigned to this task' })
  @ApiNotFoundResponse({ description: 'Task not found' })
  create(
    @Param('id') id: string,
    @Body() dto: CreateTaskCommentDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.comments.create(id, dto, req.user);
  }
}
