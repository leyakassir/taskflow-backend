import { Module } from '@nestjs/common';
import { PrismaModule } from '../database/prisma.module.js';
import { UsersService } from './users.service.js';
import { UsersController } from './users.controller.js';
import { MeController } from './me.controller.js';
import { AuthModule } from '../auth/auth.module.js';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [UsersController, MeController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}