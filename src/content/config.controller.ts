import { Controller, Get } from '@nestjs/common';

@Controller('config')
export class ConfigController {
  @Get('locales')
  getLocales() {
    return {
      defaultLocale: 'en',
      supportedLocales: ['en', 'ar'],
      legal: {
        termsUrlTemplate: '/public/legal/{lang}/terms.html',
        privacyUrlTemplate: '/public/legal/{lang}/privacy.html',
        aboutUrlTemplate: '/public/legal/{lang}/about.html',
        howToUrlTemplate: '/public/legal/{lang}/how-to.html',
      },
    };
  }
}