import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // CORS allowlist from env (comma-separated)
  const raw = process.env.CORS_ORIGINS ?? '';
  const allowlist = raw.split(',').map((o) => o.trim()).filter(Boolean);

  const origins =
    allowlist.length > 0
      ? allowlist
      : ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://10.0.2.2:3000'];

  app.enableCors({
    origin: origins,
    credentials: true,
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('TaskFlow API')
    .setDescription('TaskFlow worker/admin backend')
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', in: 'header' },
      'access-token',
    )
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port, '0.0.0.0');
}
bootstrap();
