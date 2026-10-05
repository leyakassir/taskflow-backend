import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express'; // type-only import fixes TS1272
import * as fs from 'node:fs/promises';
import { join } from 'node:path';

@Controller('legal')
export class LegalController {
  private readonly root = join(process.cwd(), 'public', 'legal');
  private readonly supported = new Set(['en', 'ar']);
  private readonly slugs = new Set(['terms', 'privacy', 'about', 'how-to']);

  @Get('page')
  async getDoc(
    @Query('slug') slug: string,
    @Query('lang') lang = 'en',
    @Res() res: Response,
  ) {
    if (!slug || !this.slugs.has(slug)) {
      throw new BadRequestException('Invalid slug. Expected: terms, privacy, about, how-to');
    }
    const locale = this.supported.has(lang) ? lang : 'en';
    const filePath = join(this.root, locale, `${slug}.html`);
    const fallbackPath = join(this.root, 'en', `${slug}.html`);

    let html: string | null = null;
    try {
      html = (await fs.readFile(filePath)).toString('utf-8');
    } catch {
      try {
        html = (await fs.readFile(fallbackPath)).toString('utf-8');
      } catch {
        return res.status(404).json({ message: 'Legal document not found', slug, lang: locale });
      }
    }

    res.type('html').send(html);
  }
}