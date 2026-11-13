import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AccessLog, Application, ApplicationSlot, Blackout, DiscountType, Evidence, Facility, IntakePeriod, Member, Org,
} from '../../entities.js';
import { AppError, fail } from '../../common/errors.js';
import { daysBetween, isValidDate, todayKst } from '../../common/holidays.js';
import { maskName, maskPhone } from '../../common/mask.js';
import { ApplicationsService } from './applications.service.js';
import { PeriodService } from './period.service.js';
import { normPhone, requireConsent, validateOrgInput } from './validators.js';

const REASONS = ['공사', '행사', '안전점검', '휴관'];

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(Application) private apps: Repository<Application>,
    @InjectRepository(ApplicationSlot) private slots: Repository<ApplicationSlot>,
    @InjectRepository(Org) private orgs: Repository<Org>,
    @InjectRepository(Member) private members: Repository<Member>,
    @InjectRepository(Facility) private facilities: Repository<Facility>,
    @InjectRepository(DiscountType) private discounts: Repository<DiscountType>,
    @InjectRepository(Evidence) private evidences: Repository<Evidence>,
    @InjectRepository(IntakePeriod) private periodRepo: Repository<IntakePeriod>,
    @InjectRepository(Blackout) private blackouts: Repository<Blackout>,
    @InjectRepository(AccessLog) private access: Repository<AccessLog>,
    private core: ApplicationsService,
    private periods: PeriodService,
  ) {}

  private async rep(org: Org | undefined): Promise<{ repName: string; phone: string }> {
    if (!org) return { repName: '', phone: '' };
    if (org.memberId) {
      const m = await this.members.findOneBy({ memberId: org.memberId });
      if (m) return { repName: m.repName, phone: m.phone };
    }
    return { repName: org.repName ?? '', phone: org.repPhone ?? '' };
  }

  private async summary(a: Application, orgMap: Map<number, Org>, discMap: Map<number, string>, counts: Map<number, number>) {
    const org = orgMap.get(a.orgId);
    const r = await this.rep(org);
    return {
      applicationId: a.applicationId,
      applicationNo: a.applicationNo,
      orgName: org?.orgName ?? '',
      repNameMasked: maskName(r.repName),
      phoneMasked: maskPhone(r.phone),
      appliedAt: a.appliedAt,
      slotCount: counts.get(a.applicationId) ?? 0,
      via: a.via,
      discountType: a.discountTypeId ? discMap.get(a.discountTypeId) ?? null : null,
      status: a.status,
    };
  }

  private async lookups() {
    const orgMap = new Map((await this.orgs.find()).map((o) => [o.orgId, o]));
    const discMap = new Map((await this.discounts.find()).map((d) => [d.discountTypeId, d.name]));
    const counts = new Map<number, number>();
    for (const s of await this.slots.find()) counts.set(s.applicationId, (counts.get(s.applicationId) ?? 0) + 1);
    return { orgMap, discMap, counts };
  }

  async listApplications(q: any) {
    const where: any = {};
    if (q.periodId) where.periodId = Number(q.periodId);
    if (q.status) where.status = q.status;
    if (q.via) where.via = q.via;
    const { orgMap, discMap, counts } = await this.lookups();
    let list = await this.apps.find({ where, order: { appliedAt: 'DESC' } });
    if (q.discountType) list = list.filter((a) => a.discountTypeId && discMap.get(a.discountTypeId) === q.discountType);
    return Promise.all(list.map((a) => this.summary(a, orgMap, discMap, counts)));
  }

  async applicationDetail(adminId: number, id: number) {
    const a = await this.apps.findOneBy({ applicationId: id });
    if (!a) fail(404, 'MSG-20', '신청을 찾을 수 없습니다.');
    await this.access.save(this.access.create({ adminId, targetType: '신청', targetId: id }));
    const { orgMap, discMap, counts } = await this.lookups();
    const base = await this.summary(a, orgMap, discMap, counts);
    const org = orgMap.get(a.orgId);
    const r = await this.rep(org);
    const d = await this.core.detail(a, false);
    return {
      ...base,
      repName: r.repName,
      phone: r.phone,
      orgType: org?.orgType ?? '',
      memberCount: org?.memberCount ?? 0,
      residentCount: org?.residentCount ?? 0,
      isResidentSnapshot: a.isResidentSnapshot,
      evidence: d.evidence,
      slots: d.slots,
      totals: d.totals,
    };
  }

  async listOrgs(search?: string) {
    const all = await this.orgs.find({ order: { orgId: 'ASC' } });
    const out: any[] = [];
    for (const o of all) {
      const r = await this.rep(o);
      if (search && !o.orgName.includes(search) && !r.repName.includes(search)) continue;
      out.push({ orgId: o.orgId, orgName: o.orgName, orgType: o.orgType, repNameMasked: maskName(r.repName) });
    }
    return out;
  }

  async createVisit(adminId: number, b: any) {
    b = b ?? {};
    if (b.applicantConfirmed !== true) throw new AppError(400, 'MSG-01', '신청자 본인 확인이 필요합니다.');
    requireConsent(b);
    let org: Org | null = null;
    if (b.orgId) {
      org = await this.orgs.findOneBy({ orgId: Number(b.orgId) });
      if (!org) throw new AppError(404, 'MSG-20', '단체를 찾을 수 없습니다.');
    } else if (b.newOrg) {
      const n = b.newOrg;
      const fields: Record<string, string> = {};
      const repName = String(n.repName ?? '').trim();
      if ([...repName].length < 2) fields.repName = '성명은 2자 이상 입력해 주세요.';
      const phone = normPhone(n.phone);
      if (!/^010\d{8}$/.test(phone)) fields.phone = '010으로 시작하는 11자리 번호를 입력해 주세요.';
      const v = validateOrgInput(n, fields);
      org = await this.orgs.save(this.orgs.create({ memberId: null, repName, repPhone: phone, ...v }));
    } else {
      throw new AppError(400, 'MSG-21', 'orgId 또는 newOrg가 필요합니다.');
    }
    const res = await this.core.create(org, b, 'visit', adminId);
    return { ...res, orgId: org.orgId, orgName: org.orgName, via: 'visit' };
  }

  async listEvidence(status?: string) {
    const list = await this.evidences.find({ where: status ? { status } : {}, order: { evidenceId: 'DESC' } });
    const appMap = new Map((await this.apps.find()).map((a) => [a.applicationId, a]));
    const orgMap = new Map((await this.orgs.find()).map((o) => [o.orgId, o]));
    const discMap = new Map((await this.discounts.find()).map((d) => [d.discountTypeId, d.name]));
    return list.map((e) => {
      const a = appMap.get(e.applicationId);
      return {
        evidenceId: e.evidenceId,
        applicationId: e.applicationId,
        applicationNo: a?.applicationNo ?? '',
        orgName: a ? orgMap.get(a.orgId)?.orgName ?? '' : '',
        discountType: a?.discountTypeId ? discMap.get(a.discountTypeId) ?? null : null,
        status: e.status,
        submittedAt: e.submittedAt,
        fileName: e.fileName,
      };
    });
  }

  async evidenceFile(adminId: number, id: number) {
    const e = await this.evidences.findOneBy({ evidenceId: id });
    if (!e) fail(404, 'MSG-20', '증빙을 찾을 수 없습니다.');
    await this.access.save(this.access.create({ adminId, targetType: '증빙', targetId: id }));
    return e;
  }

  async decideEvidence(adminId: number, id: number, b: any) {
    const e = await this.evidences.findOneBy({ evidenceId: id });
    if (!e) fail(404, 'MSG-20', '증빙을 찾을 수 없습니다.');
    if (b?.decision !== '승인' && b?.decision !== '반려') throw new AppError(400, 'MSG-21', "decision은 '승인' 또는 '반려'입니다.");
    if (b.decision === '반려' && !String(b.rejectReason ?? '').trim()) fail(400, 'MSG-16', '', { rejectReason: '반려 사유를 입력해 주세요.' });
    e.status = b.decision;
    e.rejectReason = b.decision === '반려' ? String(b.rejectReason).trim() : null;
    e.reviewedBy = adminId;
    e.reviewedAt = new Date();
    await this.evidences.save(e);
    await this.core.recalc(e.applicationId);
    return { evidenceId: e.evidenceId, status: e.status };
  }

  // ---- 접수 기간 ----
  private parseIntake(b: any) {
    const out: any = {};
    if (!/^\d{4}-\d{2}$/.test(b?.targetMonth ?? '')) throw new AppError(400, 'MSG-21', 'targetMonth(YYYY-MM)가 필요합니다.');
    out.targetMonth = b.targetMonth;
    for (const k of ['openAt', 'closeAt', 'drawAt', 'announceAt']) {
      const d = new Date(b[k]);
      if (!b[k] || isNaN(d.getTime())) throw new AppError(400, 'MSG-21', `${k} 일시가 올바르지 않습니다.`, { [k]: '일시가 올바르지 않습니다.' });
      out[k] = d;
    }
    if (!(out.openAt < out.closeAt && out.closeAt <= out.drawAt && out.drawAt <= out.announceAt)) {
      throw new AppError(400, 'MSG-21', '일정 순서는 접수 시작 < 마감 <= 추첨 <= 발표여야 합니다.');
    }
    return out;
  }

  async listIntake() {
    const drawn = await this.periods.drawnIds();
    const list = await this.periodRepo.find({ order: { openAt: 'DESC' } });
    return list.map((p) => ({
      periodId: p.periodId, targetMonth: p.targetMonth, openAt: p.openAt, closeAt: p.closeAt, drawAt: p.drawAt, announceAt: p.announceAt,
      status: this.periods.statusOf(p, drawn),
    }));
  }

  async createIntake(b: any) {
    const v = this.parseIntake(b);
    if (await this.periodRepo.findOneBy({ targetMonth: v.targetMonth })) throw new AppError(409, 'MSG-21', '이미 같은 이용 월의 접수 기간이 있습니다.');
    const p = await this.periodRepo.save(this.periodRepo.create(v as Partial<IntakePeriod>));
    return this.shapeIntake(p);
  }

  async updateIntake(id: number, b: any) {
    const p = await this.periodRepo.findOneBy({ periodId: id });
    if (!p) throw new AppError(404, 'MSG-21', '접수 기간을 찾을 수 없습니다.');
    const v = this.parseIntake({ targetMonth: p.targetMonth, openAt: p.openAt, closeAt: p.closeAt, drawAt: p.drawAt, announceAt: p.announceAt, ...b });
    if (v.targetMonth !== p.targetMonth && (await this.periodRepo.findOneBy({ targetMonth: v.targetMonth }))) {
      throw new AppError(409, 'MSG-21', '이미 같은 이용 월의 접수 기간이 있습니다.');
    }
    Object.assign(p, v);
    return this.shapeIntake(await this.periodRepo.save(p));
  }

  private async shapeIntake(p: IntakePeriod) {
    return {
      periodId: p.periodId, targetMonth: p.targetMonth, openAt: p.openAt, closeAt: p.closeAt, drawAt: p.drawAt, announceAt: p.announceAt,
      status: await this.periods.status(p),
    };
  }

  // ---- 이용 불가일 ----
  private async affected(b: Blackout): Promise<number> {
    const qb = this.slots
      .createQueryBuilder('s')
      .where("s.result != '취소' AND s.useDate >= :a AND s.useDate <= :b", { a: b.startDate, b: b.endDate });
    if (b.facilityId !== null) qb.andWhere('s.facilityId = :f', { f: b.facilityId });
    return qb.getCount();
  }

  private async shapeBlackout(b: Blackout, facMap: Map<number, string>) {
    return {
      blackoutId: b.blackoutId,
      facilityId: b.facilityId,
      facilityName: b.facilityId === null ? '전체' : facMap.get(b.facilityId) ?? '',
      startDate: b.startDate,
      endDate: b.endDate,
      reasonType: b.reasonType,
      reason: b.reason,
      affectedSlots: await this.affected(b),
    };
  }

  async listBlackouts() {
    const facMap = new Map((await this.facilities.find()).map((f) => [f.facilityId, f.name]));
    const list = await this.blackouts.find({ order: { startDate: 'ASC' } });
    return Promise.all(list.map((b) => this.shapeBlackout(b, facMap)));
  }

  async createBlackout(adminId: number, b: any) {
    b = b ?? {};
    const facilityId = b.facilityId === null || b.facilityId === undefined || b.facilityId === '' ? null : Number(b.facilityId);
    if (facilityId !== null && !(await this.facilities.findOneBy({ facilityId }))) throw new AppError(400, 'MSG-21', '시설을 찾을 수 없습니다.');
    if (!isValidDate(b.startDate) || !isValidDate(b.endDate) || b.startDate > b.endDate) {
      throw new AppError(400, 'MSG-21', '시작일·종료일이 올바르지 않습니다.');
    }
    if (!REASONS.includes(b.reasonType)) throw new AppError(400, 'MSG-21', '사유 유형이 올바르지 않습니다.');
    const row = await this.blackouts.save(
      this.blackouts.create({ facilityId, startDate: b.startDate, endDate: b.endDate, reasonType: b.reasonType, reason: String(b.reason ?? ''), registeredBy: adminId }),
    );
    const facMap = new Map((await this.facilities.find()).map((f) => [f.facilityId, f.name]));
    const out: any = await this.shapeBlackout(row, facMap);
    if (row.reasonType === '안전점검' && daysBetween(todayKst(), row.startDate) < 30) {
      out.warning = '안전점검은 시행일 30일 전까지 등록해야 합니다. 시행일까지 30일이 남지 않았으니 영향받는 신청자에게 별도 안내가 필요합니다.';
    }
    return out;
  }

  async deleteBlackout(id: number) {
    const r = await this.blackouts.delete({ blackoutId: id });
    if (!r.affected) throw new AppError(404, 'MSG-21', '이용 불가일을 찾을 수 없습니다.');
  }
}
