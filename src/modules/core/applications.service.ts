import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  Application, ApplicationSlot, Blackout, DiscountType, Evidence, Facility, IntakePeriod, Org, Rate,
} from '../../entities.js';
import { AppError, fail } from '../../common/errors.js';
import { dayOfWeek, isValidDate, isWeekendOrHoliday, isoWeekKey } from '../../common/holidays.js';
import { calcSlot, isResidentOrg, rateFor } from '../../common/pricing.js';
import { PeriodService, kstText } from './period.service.js';
import { requireConsent } from './validators.js';

export interface SlotIn { facilityId: number; date: string; startHour: number; }

@Injectable()
export class ApplicationsService {
  constructor(
    @InjectRepository(Application) private apps: Repository<Application>,
    @InjectRepository(ApplicationSlot) private slots: Repository<ApplicationSlot>,
    @InjectRepository(Org) private orgs: Repository<Org>,
    @InjectRepository(Facility) private facilities: Repository<Facility>,
    @InjectRepository(Rate) private rates: Repository<Rate>,
    @InjectRepository(DiscountType) private discounts: Repository<DiscountType>,
    @InjectRepository(Blackout) private blackouts: Repository<Blackout>,
    @InjectRepository(Evidence) private evidences: Repository<Evidence>,
    @InjectRepository(IntakePeriod) private periodRepo: Repository<IntakePeriod>,
    private periods: PeriodService,
    private config: ConfigService,
  ) {}

  async orgOfMember(memberId: number): Promise<Org> {
    const o = await this.orgs.findOneBy({ memberId });
    if (!o) fail(403, 'MSG-20', '단체 정보가 없습니다.');
    return o;
  }

  private parseSlots(raw: any): SlotIn[] {
    if (!Array.isArray(raw) || raw.length === 0) fail(400, 'MSG-09', '슬롯을 한 개 이상 선택해 주세요.');
    return raw.map((s: any) => {
      const facilityId = Number(s?.facilityId);
      const startHour = Number(s?.startHour);
      if (!Number.isInteger(facilityId) || !Number.isInteger(startHour) || !isValidDate(s?.date)) {
        fail(400, 'MSG-09', '슬롯 형식이 올바르지 않습니다.');
      }
      return { facilityId, date: s.date as string, startHour };
    });
  }

  private async findDiscount(name: any): Promise<DiscountType | null> {
    if (!name) return null;
    const d = await this.discounts.findOneBy({ name: String(name) });
    if (!d) fail(400, 'MSG-12', '(알 수 없는 감면 유형입니다.)');
    return d;
  }

  private residentFlag(org: Org, b: any): boolean {
    const mc = Number.isFinite(Number(b?.memberCount)) && b?.memberCount != null ? Number(b.memberCount) : org.memberCount;
    const rc = Number.isFinite(Number(b?.residentCount)) && b?.residentCount != null ? Number(b.residentCount) : org.residentCount;
    return isResidentOrg(mc, rc);
  }

  /** 요금 미리보기 */
  async quote(org: Org, b: any) {
    const slotsIn = this.parseSlots(b?.slots);
    const resident = this.residentFlag(org, b);
    const disc = await this.findDiscount(b?.discountType);
    const rate = disc?.discountRate ?? 0;
    const rates = await this.rates.find();
    const fids = new Set((await this.facilities.find()).map((f) => f.facilityId));
    let gross = 0;
    let discount = 0;
    const items = slotsIn.map((s) => {
      if (!fids.has(s.facilityId)) fail(400, 'MSG-09', '시설을 찾을 수 없습니다.');
      const price = rateFor(rates, s.facilityId, resident, isWeekendOrHoliday(s.date));
      const c = calcSlot(price, rate);
      gross += c.gross;
      discount += c.discount;
      return { slot: s, hours: 1, pricePerHour: price, amount: c.gross };
    });
    return {
      isResidentOrg: resident,
      items,
      grossAmount: gross,
      discountRate: rate,
      expectedDiscountAmount: discount,
      expectedNetAmount: gross - discount,
      noteText: disc
        ? '감면은 증빙 서류가 승인된 뒤에 적용됩니다. 표시된 감면액은 예상값입니다.'
        : '감면 대상이 아니면 대관료 전액이 청구됩니다.',
    };
  }

  /** 신청 생성(온라인·방문 공통). 검증 순서는 기능명세서 4.5 */
  async create(org: Org, b: any, via: 'online' | 'visit', enteredBy: number | null) {
    requireConsent(b);
    const slotsIn = this.parseSlots(b?.slots);
    const period = await this.periods.currentOpen();
    if (!period) {
      const cur = await this.periods.current();
      fail(400, 'MSG-08', cur ? `접수는 ${kstText(cur.openAt)}부터 ${kstText(cur.closeAt)}까지입니다.` : '');
    }
    const facs = await this.facilities.find();
    const facMap = new Map(facs.map((f) => [f.facilityId, f]));
    const seen = new Set<string>();
    for (const s of slotsIn) {
      const f = facMap.get(s.facilityId);
      if (!f) fail(400, 'MSG-09', '시설을 찾을 수 없습니다.');
      if (!s.date.startsWith(period.targetMonth + '-')) {
        fail(400, 'MSG-08', `이번 접수는 ${period.targetMonth} 이용분만 신청할 수 있습니다.`);
      }
      if (s.startHour < f.openHour || s.startHour >= f.closeHour) {
        fail(400, 'MSG-08', `운영 시간(${f.openHour}~${f.closeHour - 1}시 시작) 밖입니다.`);
      }
      const k = `${s.facilityId}|${s.date}|${s.startHour}`;
      if (seen.has(k)) fail(400, 'MSG-10', `(${s.date} ${s.startHour}시)`);
      seen.add(k);
    }
    // 이용 불가일
    const bos = await this.blackouts.find();
    for (const s of slotsIn) {
      const bo = bos.find((x) => (x.facilityId === null || x.facilityId === s.facilityId) && x.startDate <= s.date && s.date <= x.endDate);
      if (bo) fail(400, 'MSG-09', `(${s.date} ${s.startHour}시: ${bo.reasonType} - ${bo.reason})`);
    }
    // 이미 당첨된 슬롯
    const dates = [...new Set(slotsIn.map((s) => s.date))];
    const existingAll = await this.slots
      .createQueryBuilder('s')
      .where('s.useDate IN (:...dates)', { dates })
      .getMany();
    for (const s of slotsIn) {
      if (existingAll.some((e) => e.result === '당첨' && e.facilityId === s.facilityId && e.useDate === s.date && e.startHour === s.startHour)) {
        fail(400, 'MSG-09', `(${s.date} ${s.startHour}시: 이미 확정된 시간)`);
      }
    }
    // 같은 단체 중복
    for (const s of slotsIn) {
      if (existingAll.some((e) => e.orgId === org.orgId && e.result !== '취소' && e.facilityId === s.facilityId && e.useDate === s.date && e.startHour === s.startHour)) {
        fail(400, 'MSG-10', `(${s.date} ${s.startHour}시)`);
      }
    }
    // 정기 대관: 같은 시설·요일·시작시각 4개 이상 → 같은 시설·ISO 주당 2개 이하
    const groups = new Map<string, number>();
    const gkey = (s: SlotIn) => `${s.facilityId}|${dayOfWeek(s.date)}|${s.startHour}`;
    for (const s of slotsIn) groups.set(gkey(s), (groups.get(gkey(s)) ?? 0) + 1);
    const regularSet = new Set(slotsIn.filter((s) => (groups.get(gkey(s)) ?? 0) >= 4).map((s) => `${s.facilityId}|${s.date}|${s.startHour}`));
    const weekCount = new Map<string, number>();
    const monthSlots = await this.slots.find({ where: { orgId: org.orgId, isRegular: true } });
    for (const e of monthSlots) {
      if (e.result === '취소' || !e.useDate.startsWith(period.targetMonth)) continue;
      const k = `${e.facilityId}|${isoWeekKey(e.useDate)}`;
      weekCount.set(k, (weekCount.get(k) ?? 0) + 1);
    }
    for (const s of slotsIn) {
      if (!regularSet.has(`${s.facilityId}|${s.date}|${s.startHour}`)) continue;
      const k = `${s.facilityId}|${isoWeekKey(s.date)}`;
      weekCount.set(k, (weekCount.get(k) ?? 0) + 1);
      if (weekCount.get(k)! > 2) fail(400, 'MSG-11', `(${s.date} 주)`);
    }
    // 감면 유형(증빙은 신청 후 업로드. 승인 전에는 감면 미적용)
    const disc = await this.findDiscount(b?.discountType);
    requireConsent(b);

    const resident = this.residentFlag(org, b);
    const rates = await this.rates.find();
    const now = new Date();
    const app = await this.apps.save(
      this.apps.create({
        applicationNo: 'tmp-' + Math.random().toString(36).slice(2) + Date.now(),
        periodId: period.periodId,
        orgId: org.orgId,
        via,
        enteredBy,
        appliedAt: now,
        discountTypeId: disc?.discountTypeId ?? null,
        isResidentSnapshot: resident,
        privacyConsentAt: now,
        status: '접수',
      }),
    );
    app.applicationNo = `A-${now.getFullYear()}-${String(app.applicationId).padStart(6, '0')}`;
    await this.apps.save(app);
    try {
      await this.slots.save(
        slotsIn.map((s) => {
          const price = rateFor(rates, s.facilityId, resident, isWeekendOrHoliday(s.date));
          const c = calcSlot(price, 0);
          return this.slots.create({
            applicationId: app.applicationId,
            orgId: org.orgId,
            facilityId: s.facilityId,
            useDate: s.date,
            startHour: s.startHour,
            isRegular: regularSet.has(`${s.facilityId}|${s.date}|${s.startHour}`),
            result: '대기',
            pricePerHour: price,
            discountAmount: 0,
            netAmount: c.net,
          });
        }),
      );
    } catch (e) {
      await this.apps.delete({ applicationId: app.applicationId });
      fail(400, 'MSG-10');
    }
    return { applicationId: app.applicationId, applicationNo: app.applicationNo, appliedAt: app.appliedAt, announceAt: period.announceAt };
  }

  /** 승인된 증빙이 있으면 감면율을 적용해 슬롯 금액을 다시 계산 */
  async recalc(applicationId: number) {
    const app = await this.apps.findOneBy({ applicationId });
    if (!app) return;
    const approved = (await this.evidences.countBy({ applicationId, status: '승인' })) > 0;
    const disc = app.discountTypeId ? await this.discounts.findOneBy({ discountTypeId: app.discountTypeId }) : null;
    const rate = approved && disc ? disc.discountRate : 0;
    const slots = await this.slots.findBy({ applicationId });
    for (const s of slots) {
      const c = calcSlot(s.pricePerHour, rate);
      s.discountAmount = c.discount;
      s.netAmount = c.net;
    }
    await this.slots.save(slots);
  }

  async uploadEvidence(org: Org, applicationId: number, file: { buffer: Buffer; originalname: string; size: number } | undefined) {
    const app = await this.apps.findOneBy({ applicationId });
    if (!app || app.orgId !== org.orgId) fail(404, 'MSG-20', '신청을 찾을 수 없습니다.');
    if (!file) fail(400, 'MSG-13');
    const name = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const ext = path.extname(name).toLowerCase();
    if (!['.pdf', '.jpg', '.jpeg', '.png'].includes(ext) || file.size > 10 * 1024 * 1024) fail(400, 'MSG-13');
    const dir = path.resolve(this.config.get<string>('UPLOAD_DIR') ?? 'uploads');
    await mkdir(dir, { recursive: true });
    const stored = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
    const filePath = path.join(dir, stored);
    await writeFile(filePath, file.buffer);
    const ev = await this.evidences.save(this.evidences.create({ applicationId, filePath, fileName: name, status: '대기' }));
    return { evidenceId: ev.evidenceId, status: ev.status };
  }

  async myList(org: Org) {
    const apps = await this.apps.find({ where: { orgId: org.orgId }, order: { appliedAt: 'DESC' } });
    const periods = new Map((await this.periodRepo.find()).map((p) => [p.periodId, p]));
    const slots = await this.slots.findBy({ orgId: org.orgId });
    return apps.map((a) => ({
      applicationId: a.applicationId,
      applicationNo: a.applicationNo,
      appliedAt: a.appliedAt,
      via: a.via,
      status: a.status,
      slotCount: slots.filter((s) => s.applicationId === a.applicationId).length,
      resultPublished: periods.get(a.periodId)?.resultPublished ?? false,
    }));
  }

  /** 신청자·관리자 공통 상세. hideResult=true면 결과 발표 전 숨김 */
  async detail(app: Application, hideIfUnpublished: boolean) {
    const period = await this.periodRepo.findOneBy({ periodId: app.periodId });
    const published = period?.resultPublished ?? false;
    const hide = hideIfUnpublished && !published;
    const facs = new Map((await this.facilities.find()).map((f) => [f.facilityId, f.name]));
    const slots = await this.slots.find({ where: { applicationId: app.applicationId }, order: { useDate: 'ASC', startHour: 'ASC' } });
    const evs = await this.evidences.find({ where: { applicationId: app.applicationId }, order: { evidenceId: 'ASC' } });
    const disc = app.discountTypeId ? await this.discounts.findOneBy({ discountTypeId: app.discountTypeId }) : null;
    const sum = (f: (s: ApplicationSlot) => number) => slots.reduce((a, s) => a + f(s), 0);
    return {
      applicationId: app.applicationId,
      applicationNo: app.applicationNo,
      appliedAt: app.appliedAt,
      via: app.via,
      status: app.status,
      discountType: disc?.name ?? null,
      evidence: evs.map((e) => ({ evidenceId: e.evidenceId, status: e.status, rejectReason: e.rejectReason })),
      resultPublished: published,
      slots: slots.map((s) => ({
        slotId: s.slotId,
        facilityName: facs.get(s.facilityId) ?? '',
        date: s.useDate,
        startHour: s.startHour,
        result: hide ? '대기' : s.result,
        reasonText: hide ? null : s.reasonText,
        pricePerHour: s.pricePerHour,
        discountAmount: s.discountAmount,
        netAmount: s.netAmount,
      })),
      totals: {
        grossAmount: sum((s) => s.pricePerHour),
        discountAmount: sum((s) => s.discountAmount),
        netAmount: sum((s) => s.netAmount),
      },
    };
  }

  async myDetail(org: Org, id: number) {
    const app = await this.apps.findOneBy({ applicationId: id });
    if (!app || app.orgId !== org.orgId) fail(404, 'MSG-20', '신청을 찾을 수 없습니다.');
    return this.detail(app, true);
  }
}
