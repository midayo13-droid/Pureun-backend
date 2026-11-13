import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module.js';

async function ensureSchema() {
  // 이 서비스의 테이블은 별도 스키마에만 만든다. 같은 DB의 다른 스키마는 건드리지 않는다.
  const { default: pg } = await import('pg');
  const schema = process.env.DB_SCHEMA ?? 'rental';
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('DB_SCHEMA 값이 올바르지 않습니다.');
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await client.end();
}

async function bootstrap() {
  await import('dotenv/config');
  await ensureSchema();
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.enableCors({ origin: (process.env.CORS_ORIGIN ?? 'http://localhost:3000').split(','), credentials: true });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(process.env.PORT ?? 4000);
  console.log(`백엔드 실행: http://localhost:${process.env.PORT ?? 4000}/api`);
}
await bootstrap();
