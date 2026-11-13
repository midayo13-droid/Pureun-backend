import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ALL_ENTITIES } from '../../entities.js';
import { AdminController } from './admin.controller.js';
import { AdminService } from './admin.service.js';
import { ApplicantController } from './applicant.controller.js';
import { ApplicationsService } from './applications.service.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PeriodService } from './period.service.js';
import { PublicController } from './public.controller.js';
import { PublicService } from './public.service.js';
import { QaService } from './qa.service.js';

/** 담당: 백엔드 에이전트 1 — 인증, 시설·달력, 접수 기간, 신청·요금·증빙, 환불, 이용 불가일, 관리자 신청·증빙, 규정 검색(Q&A). */
@Module({
  imports: [TypeOrmModule.forFeature(ALL_ENTITIES)],
  controllers: [AuthController, PublicController, ApplicantController, AdminController],
  providers: [AuthService, PublicService, QaService, PeriodService, ApplicationsService, AdminService],
  exports: [PeriodService, ApplicationsService],
})
export class CoreModule {}
