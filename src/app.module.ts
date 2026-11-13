import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ALL_ENTITIES } from './entities.js';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

import { CommonModule } from './common/auth.js';
import { CoreModule } from './modules/core/core.module.js';
import { OpsModule } from './modules/ops/ops.module.js';

const FEATURE_MODULES: any[] = [CommonModule, CoreModule, OpsModule];

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.get<string>('DATABASE_URL'),
        schema: config.get<string>('DB_SCHEMA') ?? 'rental',
        ssl: { rejectUnauthorized: false },
        entities: ALL_ENTITIES,
        synchronize: true,
      }),
    }),
    TypeOrmModule.forFeature(ALL_ENTITIES),
    ...FEATURE_MODULES,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
