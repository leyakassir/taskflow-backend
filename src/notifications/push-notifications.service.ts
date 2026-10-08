import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { cert, getApps, initializeApp, type ServiceAccount } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { readFile } from 'node:fs/promises';

// Firebase error codes meaning the token will never work again.
const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

// A malformed token (e.g. a placeholder saved by a dev build) is reported as
// a generic invalid-argument error, so the message has to be checked too.
function isDeadToken(error: { code: string; message: string }): boolean {
  return (
    INVALID_TOKEN_CODES.has(error.code) ||
    (error.code === 'messaging/invalid-argument' && /registration token/i.test(error.message))
  );
}

@Injectable()
export class PushNotificationsService implements OnModuleInit {
  private readonly logger = new Logger(PushNotificationsService.name);
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

  async sendToUser(
    userId: string,
    message: { title: string; body: string; data: Record<string, string> },
  ) {
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
          notification: { title: message.title, body: message.body },
          data: message.data,
        });
        const invalidTokens: string[] = [];
        result.responses.forEach((response, index) => {
          if (response.success) return;
          if (response.error && isDeadToken(response.error)) {
            invalidTokens.push(tokens[index]!);
          } else {
            this.logger.warn(`Push failed for a device: ${response.error?.message}`);
          }
        });
        if (invalidTokens.length > 0) {
          await this.prisma.deviceToken.deleteMany({ where: { token: { in: invalidTokens } } });
          this.logger.log(`Removed ${invalidTokens.length} invalid device token(s).`);
        }
      }
    } catch (error) {
      this.logger.error('Push notification failed; continuing task request.', error);
    }
  }
}
