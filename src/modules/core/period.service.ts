import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DrawRun, IntakePeriod } from '../../entities.js';

export function kstText(d: Date): string {
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일 ${k.getUTCHours()}시`;
}

@Injectable()
export class PeriodService {
  constructor(
    @InjectRepository(IntakePeriod) private periods: Repository<IntakePeriod>,
    @InjectRepository(DrawRun) private draws: Repository<DrawRun>,
  ) {}

  statusOf(p: IntakePeriod, drawnPeriodIds: Set<number>, now = new Date()): string {
    if (now < p.openAt) return '예정';
    if (now < p.closeAt) return '접수중';
    return drawnPeriodIds.has(p.periodId) ? '추첨완료' : '마감';
  }

  async drawnIds(): Promise<Set<number>> {
    return new Set((await this.draws.find()).map((d) => d.periodId));
  }

  async status(p: IntakePeriod): Promise<string> {
    return this.statusOf(p, await this.drawnIds());
  }

  /** 지금 접수 중인 기간 */
  async currentOpen(): Promise<IntakePeriod | null> {
    const now = new Date();
    const all = await this.periods.find({ order: { openAt: 'DESC' } });
    return all.find((p) => p.openAt <= now && now < p.closeAt) ?? null;
  }

  /** 접수 중 > 가장 가까운 예정 > 가장 최근 */
  async current(): Promise<IntakePeriod | null> {
    const open = await this.currentOpen();
    if (open) return open;
    const now = new Date();
    const all = await this.periods.find({ order: { openAt: 'ASC' } });
    const future = all.find((p) => p.openAt > now);
    if (future) return future;
    return all.length ? all[all.length - 1] : null;
  }

  async shape(p: IntakePeriod) {
    return {
      periodId: p.periodId,
      targetMonth: p.targetMonth,
      openAt: p.openAt,
      closeAt: p.closeAt,
      drawAt: p.drawAt,
      announceAt: p.announceAt,
      status: await this.status(p),
      resultPublished: p.resultPublished,
    };
  }
}
