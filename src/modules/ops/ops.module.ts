import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ALL_ENTITIES } from '../../entities.js';
import { OpsController } from './ops.controller.js';
import { OpsService } from './ops.service.js';

/** 담당: 백엔드 에이전트 2 — 추첨(요약·실행·발표·기록), 통계, 이용 이력, 대시보드. */
@Module({
  imports: [TypeOrmModule.forFeature(ALL_ENTITIES)],
  controllers: [OpsController],
  providers: [OpsService],
})
export class OpsModule {}
