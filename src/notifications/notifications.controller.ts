import { Controller, Get, Param, Patch, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt.guard.js';
import type { AuthenticatedRequest } from '../common/interfaces/authenticated-request.interface.js';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto.js';
import { NotificationIdParamDto } from './dto/notification-id-param.dto.js';
import { NotificationsService } from './notifications.service.js';

@ApiTags('notifications')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'List notifications for the authenticated user' })
  @ApiQuery({
    name: 'unreadOnly',
    required: false,
    type: Boolean,
    description: 'When true, return only unread notifications',
  })
  @ApiOkResponse({ description: 'Notifications ordered newest first' })
  list(
    @Req() req: AuthenticatedRequest,
    @Query() query: ListNotificationsQueryDto,
  ) {
    return this.notifications.list(req.user.id, query.unreadOnly === true);
  }

  @Patch('read-all')
  @ApiOperation({ summary: "Mark all of the authenticated user's notifications as read" })
  @ApiOkResponse({ description: '{ updated: number } — how many were unread' })
  markAllRead(@Req() req: AuthenticatedRequest) {
    return this.notifications.markAllRead(req.user.id);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark an owned notification as read' })
  @ApiParam({ name: 'id', description: 'Notification ID' })
  @ApiOkResponse({ description: 'The updated notification' })
  @ApiNotFoundResponse({ description: 'Notification not found for this user' })
  markRead(
    @Req() req: AuthenticatedRequest,
    @Param() params: NotificationIdParamDto,
  ) {
    return this.notifications.markRead(req.user.id, params.id);
  }
}
