import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../database/prisma.service.js';
import { MailService } from '../mail/mail.service.js';

/** How long an emailed code works. */
export const RESET_CODE_TTL_MINUTES = 10;
/** Wrong guesses allowed per code before a new one must be requested. */
export const RESET_CODE_MAX_ATTEMPTS = 5;
/** A new code can be requested this soon after the previous one. */
export const RESET_CODE_RESEND_SECONDS = 60;

const INVALID_CODE = 'Invalid or expired code. Request a new one.';

const EMAIL_TEXT = {
  en: {
    subject: 'Your TaskFlow password reset code',
    intro: 'Use this code in the TaskFlow app to set a new password:',
    expiry: `It expires in ${RESET_CODE_TTL_MINUTES} minutes.`,
    ignore: "If you didn't ask to reset your password, ignore this email. Your password stays the same.",
  },
  ar: {
    subject: 'رمز إعادة تعيين كلمة مرور TaskFlow',
    intro: 'استخدم هذا الرمز في تطبيق TaskFlow لتعيين كلمة مرور جديدة:',
    expiry: `تنتهي صلاحيته خلال ${RESET_CODE_TTL_MINUTES} دقائق.`,
    ignore: 'إذا لم تطلب إعادة تعيين كلمة المرور فتجاهل هذه الرسالة، ولن تتغير كلمة المرور.',
  },
} as const;

function hashCode(userId: string, code: string): string {
  // Tied to the user so a code hash can't be reused for another account.
  return createHash('sha256').update(`${userId}:${code}`).digest('hex');
}

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && timingSafeEqual(x, y);
}

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mail: MailService,
  ) {}

  /**
   * Emails a 6-digit code. Always succeeds from the caller's point of view,
   * so the response never reveals whether an email has an account.
   */
  async requestCode(email: string, lang: 'en' | 'ar' = 'en'): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { id: true, email: true, isActive: true },
    });
    if (!user?.isActive) return;

    const latest = await this.prisma.passwordResetCode.findFirst({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (latest && Date.now() - latest.createdAt.getTime() < RESET_CODE_RESEND_SECONDS * 1000) {
      return; // Too soon: the previous code is still on its way.
    }

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    // Only the newest code works.
    await this.prisma.passwordResetCode.deleteMany({ where: { userId: user.id } });
    await this.prisma.passwordResetCode.create({
      data: {
        userId: user.id,
        codeHash: hashCode(user.id, code),
        expiresAt: new Date(Date.now() + RESET_CODE_TTL_MINUTES * 60_000),
      },
    });

    const t = EMAIL_TEXT[lang];
    const dir = lang === 'ar' ? 'rtl' : 'ltr';
    try {
      await this.mail.send({
        to: user.email,
        subject: t.subject,
        text: `${t.intro}\n\n${code}\n\n${t.expiry}\n\n${t.ignore}`,
        html: `<div dir="${dir}" style="font-family:Arial,sans-serif;font-size:15px;color:#0F1117;line-height:1.5">
<p>${t.intro}</p>
<p style="font-size:30px;font-weight:700;letter-spacing:8px;color:#5B6AF0;margin:20px 0" dir="ltr">${code}</p>
<p>${t.expiry}</p>
<p style="color:#666B87;font-size:13px">${t.ignore}</p>
</div>`,
      });
    } catch (error) {
      // Logged for the operator; the caller still gets the same answer.
      this.logger.error(`Could not send password reset email to ${user.email}`, error as Error);
    }
  }

  async resetPassword(email: string, code: string, newPassword: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      select: { id: true, isActive: true },
    });
    if (!user?.isActive) throw new BadRequestException(INVALID_CODE);

    const entry = await this.prisma.passwordResetCode.findFirst({
      where: { userId: user.id, usedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (
      !entry ||
      entry.expiresAt.getTime() < Date.now() ||
      entry.attempts >= RESET_CODE_MAX_ATTEMPTS
    ) {
      throw new BadRequestException(INVALID_CODE);
    }

    if (!sameHash(entry.codeHash, hashCode(user.id, code))) {
      await this.prisma.passwordResetCode.update({
        where: { id: entry.id },
        data: { attempts: { increment: 1 } },
      });
      throw new BadRequestException(INVALID_CODE);
    }

    const passwordHash = await bcrypt.hash(newPassword, 10);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: user.id },
        // Sessions issued before now stop working (see JwtAuthGuard).
        data: { passwordHash, passwordChangedAt: new Date() },
      }),
      this.prisma.passwordResetCode.deleteMany({ where: { userId: user.id } }),
    ]);
  }
}
