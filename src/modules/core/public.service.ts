import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ApplicationSlot, Blackout, Facility, Rate } from '../../entities.js';
import { AppError } from '../../common/errors.js';
import { daysBetween, isValidDate, isWeekendOrHoliday, todayKst } from '../../common/holidays.js';
import { PeriodService } from './period.service.js';

@Injectable()
export class PublicService {
  constructor(
    @InjectRepository(Facility) private facilities: Repository<Facility>,
    @InjectRepository(Rate) private rates: Repository<Rate>,
    @InjectRepository(Blackout) private blackouts: Repository<Blackout>,
    @InjectRepository(ApplicationSlot) private slots: Repository<ApplicationSlot>,
    private periods: PeriodService,
  ) {}

  async intakeCurrent() {
    const p = await this.periods.current();
    if (!p) throw new AppError(404, 'MSG-08', '등록된 접수 기간이 없습니다.');
    return this.periods.shape(p);
  }

  async listFacilities() {
    const fs = await this.facilities.find({ order: { facilityId: 'ASC' } });
    const rs = await this.rates.find({ order: { rateId: 'ASC' } });
    return fs.map((f) => ({
      facilityId: f.facilityId,
      name: f.name,
      capacity: f.capacity,
      openHour: f.openHour,
      closeHour: f.closeHour,
      rates: rs
        .filter((r) => r.facilityId === f.facilityId)
        .map((r) => ({ residentType: r.residentType, dayType: r.dayType, pricePerHour: r.pricePerHour })),
    }));
  }

  async calendar(facilityIdRaw: string, month: string) {
    const facilityId = Number(facilityIdRaw);
    if (!Number.isInteger(facilityId) || !/^\d{4}-\d{2}$/.test(month ?? '')) {
      throw new AppError(400, 'MSG-21', 'facilityId와 month(YYYY-MM)가 필요합니다.');
    }
    const f = await this.facilities.findOneBy({ facilityId });
    if (!f) throw new AppError(404, 'MSG-21', '시설을 찾을 수 없습니다.');
    const [y, m] = month.split('-').map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const first = `${month}-01`;
    const end = `${month}-${String(last).padStart(2, '0')}`;
    const bos = (await this.blackouts.find()).filter(
      (b) => (b.facilityId === null || b.facilityId === facilityId) && b.startDate <= end && b.endDate >= first,
    );
    const won = await this.slots
      .createQueryBuilder('s')
      .where('s.facilityId = :facilityId AND s.result = :r AND s.useDate >= :a AND s.useDate <= :b', { facilityId, r: '당첨', a: first, b: end })
      .getMany();
    const confirmed = new Set(won.map((s) => `${s.useDate}|${s.startHour}`));
    const days: any[] = [];
    for (let d = 1; d <= last; d++) {
      const date = `${month}-${String(d).padStart(2, '0')}`;
      const bo = bos.find((b) => b.startDate <= date && date <= b.endDate) ?? null;
      const slotList: any[] = [];
      for (let h = f.openHour; h < f.closeHour; h++) {
        slotList.push({ hour: h, state: bo ? 'blocked' : confirmed.has(`${date}|${h}`) ? 'confirmed' : 'available' });
      }
      days.push({
        date,
        isWeekend: isWeekendOrHoliday(date),
        blackout: bo ? { reasonType: bo.reasonType, reason: bo.reason } : null,
        slots: slotList,
      });
    }
    return { facilityId, month, days };
  }

  refundEstimate(b: any) {
    const netAmount = Number(b?.netAmount);
    if (!Number.isFinite(netAmount) || netAmount < 0 || !isValidDate(b?.useDate)) {
      throw new AppError(400, 'MSG-21', 'netAmount와 useDate(YYYY-MM-DD)가 필요합니다.');
    }
    const cancelDate = isValidDate(b.cancelDate) ? b.cancelDate : todayKst();
    let refundRate: number;
    let rule: string;
    if (b.centerReason === true) {
      refundRate = 1;
      rule = '센터 사정(공사·행사·점검·우천 등)으로 인한 취소는 100% 환불합니다.';
    } else {
      const before = daysBetween(cancelDate, b.useDate);
      if (before >= 7) {
        refundRate = 1;
        rule = '이용일 7일 전까지 취소하면 100% 환불합니다.';
      } else if (before >= 3) {
        refundRate = 0.5;
        rule = '이용일 3일 전까지(7일 전 이후) 취소하면 50% 환불합니다.';
      } else {
        refundRate = 0;
        rule = '이용일 2일 전부터 당일·노쇼는 환불되지 않습니다.';
      }
    }
    return { refundRate, refundAmount: Math.round(netAmount * refundRate), rule };
  }
}
