import { Module } from '@nestjs/common';
import { ConfigController } from './config.controller.js';
import { LegalController } from './legal.controller.js';

@Module({
  controllers: [ConfigController, LegalController],
})
export class ContentModule {}