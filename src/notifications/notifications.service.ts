import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { cert, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { readFile } from 'node:fs/promises';

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);
  private enabled = false;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    if (getApps().length) {
      this.enabled = true;
      return;
    }
    try {
      const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
      const path = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
      const credentials = json
        ? JSON.parse(json)
        : path
          ? JSON.parse(await readFile(path, 'utf8'))
          : undefined;
      if (!credentials) {
        this.logger.warn('Push notifications disabled: Firebase credentials are not configured.');
        return;
      }
      initializeApp({ credential: cert(credentials as ServiceAccount) });
      this.enabled = true;
    } catch (error) {
      this.logger.error('Push notifications could not be initialized; API will continue without push.', error);
    }
  }

  async sendTaskNotification(userId: string, title: string, body: string, taskId: string) {
    try {
      if (!this.enabled) return;
      const devices = await this.prisma.deviceToken.findMany({
        where: { userId },
        select: { token: true },
      });
      for (let start = 0; start < devices.length; start += 500) {
        const tokens = devices.slice(start, start + 500).map(({ token }) => token);
        const result = await getMessaging().sendEachForMulticast({
          tokens,
          notification: { title, body },
          data: { taskId },
        });
        result.responses.forEach((response) => {
          if (!response.success) {
            this.logger.warn(`Push failed for a device: ${response.error?.message}`);
          }
        });
      }
    } catch (error) {
      this.logger.error('Push notification failed; continuing task request.', error);
    }
  }
}
