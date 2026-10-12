import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import type { AuthenticatedRequest } from '../common/interfaces/authenticated-request.interface.js';
import { CreateSignupRequestDto } from './dto/create-signup-request.dto.js';
import { ListSignupRequestsQueryDto } from './dto/list-signup-requests-query.dto.js';
import {
  ApproveSignupRequestDto,
  RejectSignupRequestDto,
} from './dto/review-signup-request.dto.js';
import { VerifySignupRequestDto } from './dto/verify-signup-request.dto.js';
import { SignupRequestsService } from './signup-requests.service.js';

/**
 * "Request an account": public steps for the app (request a code, verify
 * it), and review for admins and managers (list, approve, reject).
 */
@Controller('signup-requests')
export class SignupRequestsController {
  constructor(private readonly requests: SignupRequestsService) {}

  /** Emails a 6-digit code. Always answers { success: true }. */
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post()
  @HttpCode(200)
  async create(@Body() dto: CreateSignupRequestDto) {
    await this.requests.request(dto);
    return { success: true };
  }

  /** A correct code sends the request to the admins. */
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('verify')
  @HttpCode(200)
  verify(@Body() dto: VerifySignupRequestDto) {
    return this.requests.verify(dto.email, dto.code);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Get()
  list(@Query() query: ListSignupRequestsQueryDto) {
    return this.requests.list(query.status);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post(':id/approve')
  @HttpCode(200)
  approve(
    @Param('id') id: string,
    @Body() dto: ApproveSignupRequestDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.requests.approve(id, dto.role, req.user);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN, UserRole.MANAGER)
  @Post(':id/reject')
  @HttpCode(200)
  reject(
    @Param('id') id: string,
    @Body() dto: RejectSignupRequestDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.requests.reject(id, dto.reason, req.user);
  }
}
