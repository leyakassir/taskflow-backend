import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  NotificationKind,
  Prisma,
  SignupRequestStatus,
  UserRole,
} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { AuditService } from '../audit/audit.service.js';
import type { RequestUser } from '../common/interfaces/authenticated-request.interface.js';
import { PrismaService } from '../database/prisma.service.js';
import { MailService } from '../mail/mail.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import {
  SIGNUP_CODE_TTL_MINUTES,
  type SignupLang,
  codeEmail,
  noticeEmail,
} from './signup-emails.js';

/** Wrong guesses allowed per code. */
export const SIGNUP_CODE_MAX_ATTEMPTS = 5;
/** A new code can be requested this soon after the previous one. */
export const SIGNUP_CODE_RESEND_SECONDS = 60;

const NOT_SENT =
  'The code is wrong or has expired, so your request was not sent. Request a new code.';

/** Never returned: password and code hashes. */
const PUBLIC_FIELDS = {
  id: true,
  email: true,
  fullName: true,
  status: true,
  verifiedAt: true,
  reviewedAt: true,
  rejectionReason: true,
  createdAt: true,
  reviewedBy: { select: { id: true, fullName: true } },
} as const;

function hashCode(requestId: string, code: string) {
  return createHash('sha256').update(`${requestId}:${code}`).digest('hex');
}

function sameHash(a: string, b: string) {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

function langOf(value: string | null | undefined): SignupLang {
  return value === 'ar' ? 'ar' : 'en';
}

@Injectable()
export class SignupRequestsService {
  private readonly logger = new Logger(SignupRequestsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Step 1: emails a 6-digit code. Answers the same in every case, so the
   * endpoint can't be used to find out which emails have accounts; people
   * who already have an account or a pending request get an email saying so.
   */
  async request(input: { fullName: string; email: string; password: string; lang?: SignupLang }) {
    const email = input.email.trim().toLowerCase();
    const lang = langOf(input.lang);

    const user = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (user) return this.sendNotice(email, lang, 'exists');

    const pending = await this.prisma.signupRequest.findFirst({
      where: { email, status: SignupRequestStatus.PENDING },
      select: { id: true },
    });
    if (pending) return this.sendNotice(email, lang, 'pending');

    const latest = await this.prisma.signupRequest.findFirst({
      where: { email, status: SignupRequestStatus.UNVERIFIED },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (latest && Date.now() - latest.createdAt.getTime() < SIGNUP_CODE_RESEND_SECONDS * 1000) {
      return; // The previous code is still on its way.
    }

    // Only the newest unverified request counts.
    await this.prisma.signupRequest.deleteMany({
      where: { email, status: SignupRequestStatus.UNVERIFIED },
    });
    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const created = await this.prisma.signupRequest.create({
      data: {
        email,
        fullName: input.fullName.trim(),
        passwordHash: await bcrypt.hash(input.password, 10),
        lang,
      },
      select: { id: true },
    });
    await this.prisma.signupRequest.update({
      where: { id: created.id },
      data: {
        codeHash: hashCode(created.id, code),
        codeExpiresAt: new Date(Date.now() + SIGNUP_CODE_TTL_MINUTES * 60_000),
      },
    });
    await this.send(email, codeEmail(lang, code));
  }

  /**
   * Step 2: a correct code sends the request to the admins. Anything else
   * (wrong, expired, too many tries, unknown email) is the same 400, and
   * nothing is sent.
   */
  async verify(emailInput: string, code: string) {
    const email = emailInput.trim().toLowerCase();
    const entry = await this.prisma.signupRequest.findFirst({
      where: { email, status: SignupRequestStatus.UNVERIFIED },
      orderBy: { createdAt: 'desc' },
    });
    if (
      !entry?.codeHash ||
      !entry.codeExpiresAt ||
      entry.codeExpiresAt.getTime() < Date.now() ||
      entry.attempts >= SIGNUP_CODE_MAX_ATTEMPTS
    ) {
      throw new BadRequestException(NOT_SENT);
    }
    if (!sameHash(entry.codeHash, hashCode(entry.id, code))) {
      await this.prisma.signupRequest.update({
        where: { id: entry.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException(NOT_SENT);
    }

    // Someone may have created the account meanwhile.
    const exists = await this.prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (exists) {
      await this.prisma.signupRequest.delete({ where: { id: entry.id } });
      throw new ConflictException('An account with this email already exists. Sign in instead.');
    }

    await this.prisma.signupRequest.update({
      where: { id: entry.id },
      data: {
        status: SignupRequestStatus.PENDING,
        verifiedAt: new Date(),
        codeHash: null,
        codeExpiresAt: null,
      },
    });
    await this.notifyStaff(entry.id, entry.fullName, email);
    return { status: SignupRequestStatus.PENDING };
  }

  list(status: SignupRequestStatus | 'ALL' = SignupRequestStatus.PENDING) {
    const where: Prisma.SignupRequestWhereInput =
      status === 'ALL'
        ? { status: { not: SignupRequestStatus.UNVERIFIED } }
        : { status };
    return this.prisma.signupRequest.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: PUBLIC_FIELDS,
    });
  }

  /** Creates the account with the password the person chose. */
  async approve(id: string, role: UserRole = UserRole.WORKER, actor: RequestUser) {
    const request = await this.pendingRequest(id);
    const taken = await this.prisma.user.findUnique({
      where: { email: request.email },
      select: { id: true },
    });
    if (taken) throw new ConflictException('An account with this email already exists.');

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: request.email,
          fullName: request.fullName,
          passwordHash: request.passwordHash,
          role,
          isActive: true,
        },
        select: { id: true, email: true, fullName: true, role: true, isActive: true },
      });
      await tx.signupRequest.update({
        where: { id },
        data: {
          status: SignupRequestStatus.APPROVED,
          reviewedById: actor.id,
          reviewedAt: new Date(),
        },
      });
      await this.audit.record(
        {
          action: AuditAction.USER_CREATED,
          actorId: actor.id,
          targetUserId: created.id,
          details: {
            fullName: created.fullName,
            email: created.email,
            role: created.role,
            source: 'signup_request',
          },
        },
        tx,
      );
      return created;
    });

    await this.send(request.email, noticeEmail(langOf(request.lang), 'approved'));
    this.realtime.publish({ type: 'signup' }, [], { staff: true });
    return user;
  }

  async reject(id: string, reason: string | undefined, actor: RequestUser) {
    const request = await this.pendingRequest(id);
    const updated = await this.prisma.signupRequest.update({
      where: { id },
      data: {
        status: SignupRequestStatus.REJECTED,
        reviewedById: actor.id,
        reviewedAt: new Date(),
        rejectionReason: reason?.trim() || null,
      },
      select: PUBLIC_FIELDS,
    });
    await this.send(request.email, noticeEmail(langOf(request.lang), 'rejected', reason?.trim()));
    this.realtime.publish({ type: 'signup' }, [], { staff: true });
    return updated;
  }

  private async pendingRequest(id: string) {
    const request = await this.prisma.signupRequest.findUnique({ where: { id } });
    if (!request || request.status === SignupRequestStatus.UNVERIFIED) {
      throw new NotFoundException('Account request not found');
    }
    if (request.status !== SignupRequestStatus.PENDING) {
      throw new ConflictException('This request was already reviewed.');
    }
    return request;
  }

  /** In-app notification (and push) to every active admin and manager. */
  private async notifyStaff(requestId: string, fullName: string, email: string) {
    const staff = await this.prisma.user.findMany({
      where: { isActive: true, role: { in: [UserRole.ADMIN, UserRole.MANAGER] } },
      select: { id: true },
    });
    for (const { id } of staff) {
      await this.notifications.notify({
        userId: id,
        kind: NotificationKind.SIGNUP_REQUEST,
        title: 'New account request',
        body: `${fullName} (${email}) asked for a TaskFlow account.`,
        dedupeKey: `signup:${requestId}`,
      });
    }
    this.realtime.publish({ type: 'signup' }, [], { staff: true });
  }

  private sendNotice(email: string, lang: SignupLang, kind: 'exists' | 'pending') {
    return this.send(email, noticeEmail(lang, kind));
  }

  /** Mail failures are logged, never shown, so answers stay the same. */
  private async send(to: string, mail: { subject: string; text: string; html: string }) {
    try {
      await this.mail.send({ to, ...mail });
    } catch (error) {
      this.logger.error(`Could not send account-request email to ${to}`, error as Error);
    }
  }
}
