import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Express } from 'express';
import { JwtAuthGuard } from '../auth/jwt.guard.js';
import type { AuthenticatedRequest } from '../common/interfaces/authenticated-request.interface.js';
import { UsersService } from './users.service.js';
import { UpdateSelfDto } from './dto/update-self.dto.js';
import { ChangePasswordSelfDto } from './dto/change-password-self.dto.js';
import { RegisterDeviceTokenDto } from './dto/register-device-token.dto.js';

@UseGuards(JwtAuthGuard)
@Controller('me')
export class MeController {
  constructor(private readonly users: UsersService) {}

  @Get()
  async getSelf(@Req() req: AuthenticatedRequest) {
    return this.users.findOne(req.user.id);
  }

  @Patch()
  async updateSelf(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateSelfDto,
  ) {
    return this.users.update(req.user.id, { fullName: dto.fullName });
  }

  @Patch('password')
  async changePassword(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ChangePasswordSelfDto,
  ) {
    return this.users.changeOwnPassword(req.user.id, dto);
  }

  @Post('device-token')
  async registerDeviceToken(
    @Req() req: AuthenticatedRequest,
    @Body() dto: RegisterDeviceTokenDto,
  ) {
    return this.users.registerDeviceToken(req.user.id, dto.token);
  }

  @Post('avatar')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, callback) => {
          const directory = join(process.cwd(), 'uploads', 'avatars');
          mkdirSync(directory, { recursive: true });
          callback(null, directory);
        },
        filename: (_req, file, callback) => {
          const extension =
            file.mimetype.split('/')[1]?.replace('jpeg', 'jpg') ?? 'img';
          callback(
            null,
            `${Date.now()}-${Math.round(Math.random() * 1e9)}.${extension}`,
          );
        },
      }),
      fileFilter: (_req, file, callback) => {
        const supportedImages = new Set([
          'image/jpeg',
          'image/png',
          'image/webp',
          'image/gif',
          'image/heic',
          'image/heif',
        ]);
        if (!supportedImages.has(file.mimetype)) {
          callback(
            new BadRequestException('Only supported image files are allowed.'),
            false,
          );
          return;
        }
        callback(null, true);
      },
      limits: { fileSize: 10 * 1024 * 1024 },
    }),
  )
  async uploadAvatar(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file || !file.mimetype.startsWith('image/')) {
      throw new BadRequestException('A valid image file is required.');
    }
    const result = await this.users.updateAvatar(
      req.user.id,
      `/uploads/avatars/${file.filename}`,
    );
    return { avatarUrl: result.avatarUrl };
  }
}
