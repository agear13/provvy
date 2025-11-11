import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Allow your Next.js dev server to call this API
  app.enableCors({
    origin: ['http://localhost:3000', 'http://localhost:3001'],
  });

  const port = process.env.PORT || 4000;
  await app.listen(port);

  console.log(`🚀 Provvypay API running at http://localhost:${port}`);
}

void bootstrap();
