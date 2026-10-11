import { Injectable, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@prisma/client';
import sanitizeHtml from 'sanitize-html';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { AuditService } from '../audit/audit.service.js';
import type { RequestUser } from '../common/interfaces/authenticated-request.interface.js';

export const LEGAL_SLUGS = ['terms', 'privacy', 'about', 'how-to'] as const;
export const LEGAL_LANGS = ['en', 'ar'] as const;
export type LegalSlug = (typeof LEGAL_SLUGS)[number];
export type LegalLang = (typeof LEGAL_LANGS)[number];

// The page body sits between these markers, so a saved file can be read back for editing.
const START = '<!--content-->';
const END = '<!--/content-->';

// Only what the editor produces; everything else is stripped (pages open in the app's web view).
const SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: ['h2', 'h3', 'p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li', 'a', 'blockquote'],
  allowedAttributes: { a: ['href'] },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  transformTags: {
    div: 'p',
    b: 'strong',
    i: 'em',
    h1: 'h2',
    h4: 'h3',
  },
  exclusiveFilter: (frame) => frame.tag === 'p' && !frame.text.trim() && !frame.mediaChildren.length,
};

const escape = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const unescape = (text: string) =>
  text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');

const UPDATED_LABEL: Record<LegalLang, string> = { en: 'Last updated', ar: 'آخر تحديث' };
const DATE_LOCALE: Record<LegalLang, string> = { en: 'en-GB', ar: 'ar-u-nu-latn' };

function render(lang: LegalLang, title: string, body: string, updatedAt: Date) {
  const date = new Intl.DateTimeFormat(DATE_LOCALE[lang], { dateStyle: 'long' }).format(updatedAt);
  return `<!doctype html>
<html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>
<link rel="stylesheet" href="/public/legal/legal.css">
</head>
<body>
<main class="doc">
<h1>${escape(title)}</h1>
${START}
${body}
${END}
<p class="doc-updated">${UPDATED_LABEL[lang]}: ${date}</p>
</main>
</body>
</html>
`;
}

/** Reads a page written by render(), or one of the original hand-written placeholder files. */
function parse(html: string) {
  const title = unescape(
    (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim(),
  );
  const marked = html.indexOf(START);
  const body =
    marked !== -1
      ? html.slice(marked + START.length, html.indexOf(END)).trim()
      : (html.match(/<body[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? '').replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, '').trim();
  return { title, body };
}

@Injectable()
export class LegalPagesService {
  private readonly root = join(process.cwd(), 'public', 'legal');

  constructor(private readonly audit: AuditService) {}

  private file(slug: LegalSlug, lang: LegalLang) {
    return join(this.root, lang, `${slug}.html`);
  }

  async read(slug: LegalSlug, lang: LegalLang) {
    const path = this.file(slug, lang);
    try {
      const [html, info] = await Promise.all([fs.readFile(path, 'utf-8'), fs.stat(path)]);
      return { slug, lang, ...parse(html.replace(/^﻿/, '')), updatedAt: info.mtime };
    } catch {
      throw new NotFoundException('Page not found');
    }
  }

  async list() {
    const pages = [];
    for (const slug of LEGAL_SLUGS) {
      for (const lang of LEGAL_LANGS) {
        const page = await this.read(slug, lang).catch(() => null);
        pages.push({ slug, lang, title: page?.title ?? null, updatedAt: page?.updatedAt ?? null });
      }
    }
    return pages;
  }

  async save(slug: LegalSlug, lang: LegalLang, input: { title: string; body: string }, actor: RequestUser) {
    const before = await this.read(slug, lang).catch(() => null);
    const title = input.title.trim();
    const body = sanitizeHtml(input.body, SANITIZE).trim();

    // Write to a temporary file first, so the app never opens a half-written page.
    const path = this.file(slug, lang);
    await fs.mkdir(join(this.root, lang), { recursive: true });
    await fs.writeFile(`${path}.tmp`, render(lang, title, body, new Date()), 'utf-8');
    await fs.rename(`${path}.tmp`, path);

    // Before/after both logged so the admin can restore an earlier version.
    await this.audit.record({
      action: AuditAction.LEGAL_PAGE_UPDATED,
      actorId: actor.id,
      details: {
        slug,
        lang,
        title,
        before: before ? { title: before.title, body: before.body } : null,
        after: { title, body },
      },
    });
    return this.read(slug, lang);
  }
}
