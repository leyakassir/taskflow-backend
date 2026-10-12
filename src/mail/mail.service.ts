import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/**
 * Sends email over SMTP. Configure SMTP_HOST, SMTP_PORT, SMTP_USER,
 * SMTP_PASS and MAIL_FROM in .env (SMTP_SECURE=true for port 465).
 *
 * Without SMTP_HOST the message is written to the backend log instead,
 * so password reset can be tested locally. Never leave it unset in
 * production: anyone with log access could read reset codes.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;

  constructor(config: ConfigService) {
    const host = config.get<string>('SMTP_HOST');
    this.from = config.get<string>('MAIL_FROM') ?? 'TaskFlow <no-reply@taskflow.local>';
    this.transporter = host
      ? nodemailer.createTransport({
          host,
          port: Number(config.get<string>('SMTP_PORT') ?? 587),
          secure: config.get<string>('SMTP_SECURE') === 'true',
          auth: config.get<string>('SMTP_USER')
            ? { user: config.get<string>('SMTP_USER'), pass: config.get<string>('SMTP_PASS') }
            : undefined,
        })
      : null;
  }

  get isConfigured(): boolean {
    return this.transporter !== null;
  }

  async send(mail: OutgoingMail): Promise<void> {
    if (!this.transporter) {
      this.logger.warn(
        `SMTP is not configured; email to ${mail.to} was not sent.\n` +
          `Subject: ${mail.subject}\n${mail.text}`,
      );
      return;
    }
    await this.transporter.sendMail({ from: this.from, ...mail });
  }
}
