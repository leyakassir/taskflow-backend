import { BadRequestException, Body, Controller, Get, Param, Put, Req, UseGuards } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt.guard.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { RolesGuard } from '../common/guards/roles.guard.js';
import type { AuthenticatedRequest } from '../common/interfaces/authenticated-request.interface.js';
import { SaveLegalPageDto } from './dto/save-legal-page.dto.js';
import {
  LEGAL_LANGS,
  LEGAL_SLUGS,
  LegalPagesService,
  type LegalLang,
  type LegalSlug,
} from './legal-pages.service.js';

function checkPage(slug: string, lang: string): [LegalSlug, LegalLang] {
  if (!(LEGAL_SLUGS as readonly string[]).includes(slug)) {
    throw new BadRequestException(`Invalid page. Expected: ${LEGAL_SLUGS.join(', ')}`);
  }
  if (!(LEGAL_LANGS as readonly string[]).includes(lang)) {
    throw new BadRequestException(`Invalid language. Expected: ${LEGAL_LANGS.join(', ')}`);
  }
  return [slug as LegalSlug, lang as LegalLang];
}

// Admin editing for the static legal pages; the app keeps reading the same files.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN, UserRole.MANAGER)
@Controller('legal/pages')
export class LegalPagesController {
  constructor(private readonly pages: LegalPagesService) {}

  @Get()
  list() {
    return this.pages.list();
  }

  @Get(':slug/:lang')
  read(@Param('slug') slug: string, @Param('lang') lang: string) {
    return this.pages.read(...checkPage(slug, lang));
  }

  @Put(':slug/:lang')
  save(
    @Param('slug') slug: string,
    @Param('lang') lang: string,
    @Body() dto: SaveLegalPageDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const [s, l] = checkPage(slug, lang);
    return this.pages.save(s, l, dto, req.user);
  }
}
