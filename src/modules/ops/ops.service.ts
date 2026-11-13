import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { randomInt } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { fail } from '../../common/errors.js';
import { maskName } from '../../common/mask.js';
import {
  Application, ApplicationSlot, Blackout, DrawRun, DrawSlotLog, Evidence, Facility, IntakePeriod, Member, Org,
} from '../../entities.js';

const KST = 9 * 3600 * 1000;
const kstDate = (d: Date) => new Date(d.getTime() + KST).toISOString().slice(0, 10);

/** ISO 주 키: 'YYYY-Www' */
function isoWeek(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const y = d.getUTCFullYear();
  const w = Math.ceil(((d.getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${w}`;
}

function reasonWin(n: number) {
  return n <= 1
    ? '이 시간대에는 1건이 신청되어 단독 선정되었습니다.'
    : `이 시간대에는 ${n}건이 신청되어 무작위 추첨으로 선정되었습니다.`;
}
const reasonLose = (n: number) => `${n}건이 신청되어 같은 기준의 무작위 추첨을 했으나 선정되지 않았습니다. 남은 시간대 신청 방법은 센터 공지를 확인하세요.`;

@Injectable()
export class OpsService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  // ---- 접수 기간 ----
  private statusOf(p: IntakePeriod, hasRun: boolean, now = new Date()) {
    if (now < p.openAt) return '예정';
    if (now <= p.closeAt) return '접수중';
    return hasRun ? '추첨완료' : '마감';
  }

  private async findPeriod(periodId?: number): Promise<IntakePeriod | null> {
    const repo = this.ds.getRepository(IntakePeriod);
    if (periodId) return repo.findOneBy({ periodId });
    const now = new Date();
    const started = await repo.createQueryBuilder('p').where('p.openAt <= :now', { now }).orderBy('p.openAt', 'DESC').getOne();
    if (started) return started;
    return repo.createQueryBuilder('p').orderBy('p.openAt', 'ASC').getOne();
  }

  // ---- 추첨 현황 ----
  async summary(periodId?: number) {
    const p = await this.findPeriod(periodId);
    if (!p) fail(404, 'MSG-21', '접수 기간이 없습니다.');
    const run = await this.ds.getRepository(DrawRun).findOneBy({ periodId: p.periodId });
    const now = new Date();
    let totalApplications = 0, totalSlots = 0, competitiveSlots = 0, singleSlots = 0;
    if (run) {
      totalApplications = run.totalApplications;
      totalSlots = run.totalSlots;
      const logs = await this.ds.getRepository(DrawSlotLog).find({ where: { drawId: run.drawId } });
      competitiveSlots = logs.filter((l) => l.applicantCount >= 2).length;
      singleSlots = logs.filter((l) => l.applicantCount < 2).length;
    } else {
      const rows: { cnt: string }[] = await this.ds.getRepository(ApplicationSlot).createQueryBuilder('s')
        .innerJoin(Application, 'a', 'a.applicationId = s.applicationId')
        .select('COUNT(*)', 'cnt')
        .where('a.periodId = :pid AND a.status = :st AND s.result = :r', { pid: p.periodId, st: '접수', r: '대기' })
        .groupBy('s.facilityId').addGroupBy('s.useDate').addGroupBy('s.startHour').getRawMany();
      totalSlots = rows.length;
      competitiveSlots = rows.filter((r) => Number(r.cnt) >= 2).length;
      singleSlots = rows.filter((r) => Number(r.cnt) < 2).length;
      totalApplications = await this.ds.getRepository(Application).countBy({ periodId: p.periodId, status: '접수' });
    }
    return {
      periodId: p.periodId, targetMonth: p.targetMonth, status: this.statusOf(p, !!run, now), closeAt: p.closeAt,
      totalApplications, totalSlots, competitiveSlots, singleSlots, alreadyDrawn: !!run,
      canRun: now > p.closeAt && !run, drawId: run?.drawId ?? null, published: p.resultPublished,
    };
  }

  // ---- 추첨 실행 ----
  async runDraw(periodId: number, adminId: number) {
    if (!Number.isInteger(periodId)) fail(400, 'MSG-14', '접수 기간을 선택해 주세요.');
    const period = await this.ds.getRepository(IntakePeriod).findOneBy({ periodId });
    if (!period) fail(404, 'MSG-21', '접수 기간이 없습니다.');
    if (new Date() <= period.closeAt) fail(400, 'MSG-14');
    try {
      return await this.ds.transaction((m) => this.drawTx(m, period, adminId));
    } catch (e: any) {
      if (e?.code === '23505' && /periodId|draw_run/i.test(String(e?.detail ?? '') + String(e?.constraint ?? ''))) fail(409, 'MSG-15');
      throw e;
    }
  }

  private async drawTx(m: EntityManager, period: IntakePeriod, adminId: number) {
    if (await m.findOneBy(DrawRun, { periodId: period.periodId })) fail(409, 'MSG-15');
    const slots = await m.createQueryBuilder(ApplicationSlot, 's')
      .innerJoin(Application, 'a', 'a.applicationId = s.applicationId')
      .where('a.periodId = :pid AND a.status = :st AND s.result = :r', { pid: period.periodId, st: '접수', r: '대기' })
      .orderBy('s.slotId', 'ASC').getMany();

    const groups = new Map<string, ApplicationSlot[]>();
    for (const s of slots) {
      const k = `${s.facilityId}|${s.useDate}|${s.startHour}`;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k)!.push(s);
    }
    const keys = [...groups.keys()];
    const record: string[] = [];
    // 묶음 순서 섞기 (Fisher-Yates, crypto.randomInt)
    for (let i = keys.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [keys[i], keys[j]] = [keys[j], keys[i]];
    }

    // 이미 당첨된 슬롯(다른 기간 등)은 다시 당첨시키지 않는다
    const taken = new Set<string>();
    if (keys.length) {
      const dates = [...new Set(slots.map((s) => s.useDate))];
      const ex = await m.createQueryBuilder(ApplicationSlot, 's').where('s.result = :r AND s.useDate IN (:...d)', { r: '당첨', d: dates }).getMany();
      for (const s of ex) taken.add(`${s.facilityId}|${s.useDate}|${s.startHour}`);
    }

    const wins = new Map<string, number>(); // org|facility|isoWeek
    type Bucket = { ids: number[]; reason: string };
    const winnersBy = new Map<string, Bucket>();
    const losersBy = new Map<string, Bucket>();
    const push = (mp: Map<string, Bucket>, id: number, reason: string) => {
      if (!mp.has(reason)) mp.set(reason, { ids: [], reason });
      mp.get(reason)!.ids.push(id);
    };
    const logs: Partial<DrawSlotLog>[] = [];
    let singleCount = 0, lotteryCount = 0, emptyCount = 0;
    const weekKey = (s: ApplicationSlot) => `${s.orgId}|${s.facilityId}|${isoWeek(s.useDate)}`;

    const appIds = new Set(slots.map((s) => s.applicationId));
    const run = await m.save(DrawRun, m.create(DrawRun, {
      periodId: period.periodId, runAt: new Date(), runBy: adminId, ruleVersion: 'v1', randomRecord: '',
      totalApplications: appIds.size, totalSlots: keys.length,
    }));

    for (const k of keys) {
      const g = groups.get(k)!;
      const n = g.length;
      const [fid, date, hour] = k.split('|');
      let winner: ApplicationSlot | null = null;
      if (taken.has(k)) {
        winner = null;
      } else if (n === 1) {
        winner = g[0];
      } else {
        const cands = g.filter((s) => !(s.isRegular && (wins.get(weekKey(s)) ?? 0) >= 2));
        if (cands.length) {
          const idx = randomInt(cands.length);
          record.push(`${k}:${idx}/${cands.length}`);
          winner = cands[idx];
        }
      }
      if (winner) {
        wins.set(weekKey(winner), (wins.get(weekKey(winner)) ?? 0) + 1);
        push(winnersBy, winner.slotId, reasonWin(n));
        for (const s of g) if (s !== winner) push(losersBy, s.slotId, reasonLose(n));
        if (n === 1) singleCount++; else lotteryCount++;
      } else {
        for (const s of g) push(losersBy, s.slotId, reasonLose(n));
        emptyCount++;
      }
      logs.push({
        drawId: run.drawId, facilityId: Number(fid), useDate: date, startHour: Number(hour), applicantCount: n,
        winnerApplicationId: winner?.applicationId ?? null, method: !winner ? '공석' : n === 1 ? '단독선정' : '무작위추첨',
      });
    }

    const apply = async (mp: Map<string, Bucket>, result: string) => {
      for (const { ids, reason } of mp.values()) {
        for (let i = 0; i < ids.length; i += 1000) {
          await m.createQueryBuilder().update(ApplicationSlot).set({ result, drawId: run.drawId, reasonText: reason })
            .where('slotId IN (:...ids)', { ids: ids.slice(i, i + 1000) }).execute();
        }
      }
    };
    await apply(winnersBy, '당첨');
    await apply(losersBy, '탈락');
    if (appIds.size) await m.createQueryBuilder().update(Application).set({ status: '추첨완료' }).where('applicationId IN (:...ids)', { ids: [...appIds] }).execute();
    for (let i = 0; i < logs.length; i += 500) await m.insert(DrawSlotLog, logs.slice(i, i + 500));
    await m.update(DrawRun, { drawId: run.drawId }, { randomRecord: record.join(';') });

    return { drawId: run.drawId, totalApplications: appIds.size, totalSlots: keys.length, singleCount, lotteryCount, emptyCount };
  }

  async publish(drawId: number) {
    const run = await this.ds.getRepository(DrawRun).findOneBy({ drawId });
    if (!run) fail(404, 'MSG-21', '추첨 기록이 없습니다.');
    await this.ds.getRepository(IntakePeriod).update({ periodId: run.periodId }, { resultPublished: true });
    return { published: true };
  }

  // ---- 추첨 기록 ----
  async logs() {
    return this.ds.getRepository(DrawRun).createQueryBuilder('r')
      .innerJoin(IntakePeriod, 'p', 'p.periodId = r.periodId')
      .select(['r.drawId AS "drawId"', 'r.periodId AS "periodId"', 'p.targetMonth AS "targetMonth"', 'r.runAt AS "runAt"',
        'r.totalApplications AS "totalApplications"', 'r.totalSlots AS "totalSlots"', 'r.ruleVersion AS "ruleVersion"'])
      .orderBy('r.runAt', 'DESC').getRawMany();
  }

  async logDetail(id: number) {
    const run = await this.ds.getRepository(DrawRun).findOneBy({ drawId: id });
    if (!run) fail(404, 'MSG-21', '추첨 기록이 없습니다.');
    const period = await this.ds.getRepository(IntakePeriod).findOneBy({ periodId: run.periodId });
    const admin = run.runBy ? await this.ds.getRepository(Member).findOneBy({ memberId: run.runBy }) : null;
    const rows: any[] = await this.ds.getRepository(DrawSlotLog).createQueryBuilder('l')
      .innerJoin(Facility, 'f', 'f.facilityId = l.facilityId')
      .leftJoin(Application, 'a', 'a.applicationId = l.winnerApplicationId')
      .select(['f.name AS "facilityName"', "to_char(l.useDate, 'YYYY-MM-DD') AS \"date\"", 'l.startHour AS "startHour"', 'l.applicantCount AS "applicantCount"',
        'l.method AS "method"', 'a.applicationNo AS "winnerApplicationNo"'])
      .where('l.drawId = :id', { id }).orderBy('l.useDate').addOrderBy('l.startHour').addOrderBy('f.name').getRawMany();
    return {
      drawId: run.drawId, periodId: run.periodId, targetMonth: period?.targetMonth ?? null, runAt: run.runAt,
      runByMasked: maskName(admin?.repName), totalApplications: run.totalApplications, totalSlots: run.totalSlots, ruleVersion: run.ruleVersion,
      slots: rows,
    };
  }

  // ---- 통계 ----
  async stats(month?: string) {
    const ym = month && /^\d{4}-\d{2}$/.test(month) ? month : kstDate(new Date()).slice(0, 7);
    const [y, mo] = ym.split('-').map(Number);
    const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const start = `${ym}-01`;
    const end = `${ym}-${String(daysInMonth).padStart(2, '0')}`;
    const facs = await this.ds.getRepository(Facility).find({ order: { facilityId: 'ASC' } });
    const bos = await this.ds.getRepository(Blackout).createQueryBuilder('b').where('b.startDate <= :end AND b.endDate >= :start', { start, end }).getMany();
    const agg: any[] = await this.ds.getRepository(ApplicationSlot).createQueryBuilder('s')
      .innerJoin(Application, 'a', 'a.applicationId = s.applicationId')
      .select('s.facilityId', 'facilityId').addSelect('COUNT(DISTINCT s.applicationId)', 'cnt').addSelect('COUNT(*)', 'hours').addSelect('COALESCE(SUM(s.netAmount),0)', 'revenue')
      .where("s.result = '당첨' AND a.status <> '취소' AND s.useDate BETWEEN :start AND :end", { start, end }).groupBy('s.facilityId').getRawMany();
    const rows = facs.map((f) => {
      const blocked = new Set<string>();
      for (const b of bos) {
        if (b.facilityId !== null && b.facilityId !== f.facilityId) continue;
        const from = b.startDate < start ? start : b.startDate;
        const to = b.endDate > end ? end : b.endDate;
        for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) blocked.add(d.toISOString().slice(0, 10));
      }
      const availableHours = (daysInMonth - blocked.size) * (f.closeHour - f.openHour);
      const a = agg.find((x) => Number(x.facilityId) === f.facilityId);
      const confirmedHours = a ? Number(a.hours) : 0;
      return {
        facilityId: f.facilityId, facilityName: f.name, confirmedCount: a ? Number(a.cnt) : 0, confirmedHours, availableHours,
        utilization: availableHours ? Math.round((confirmedHours / availableHours) * 10000) / 10000 : 0, revenue: a ? Number(a.revenue) : 0,
      };
    });
    const sum = (k: 'confirmedCount' | 'confirmedHours' | 'availableHours' | 'revenue') => rows.reduce((t, r) => t + r[k], 0);
    const total = {
      confirmedCount: sum('confirmedCount'), confirmedHours: sum('confirmedHours'), availableHours: sum('availableHours'),
      utilization: sum('availableHours') ? Math.round((sum('confirmedHours') / sum('availableHours')) * 10000) / 10000 : 0, revenue: sum('revenue'),
    };
    return { month: ym, rows, total };
  }

  // ---- 이용 이력 ----
  async usageHistory(from?: string, to?: string, facilityId?: number, orgName?: string) {
    const qb = this.ds.getRepository(ApplicationSlot).createQueryBuilder('s')
      .innerJoin(Application, 'a', 'a.applicationId = s.applicationId')
      .innerJoin(Org, 'o', 'o.orgId = s.orgId')
      .leftJoin(Member, 'm', 'm.memberId = o.memberId')
      .innerJoin(Facility, 'f', 'f.facilityId = s.facilityId')
      .select(['s.applicationId AS "applicationId"', "to_char(s.useDate, 'YYYY-MM-DD') AS \"date\"", 's.startHour AS "startHour"', 'f.name AS "facilityName"',
        'o.orgName AS "orgName"', 'COALESCE(m.repName, o.repName) AS "repName"'])
      .where("s.result = '당첨' AND a.status <> '취소'");
    if (from) qb.andWhere('s.useDate >= :from', { from });
    if (to) qb.andWhere('s.useDate <= :to', { to });
    if (facilityId) qb.andWhere('s.facilityId = :fid', { fid: facilityId });
    if (orgName) qb.andWhere('o.orgName ILIKE :on', { on: `%${orgName}%` });
    const raw: any[] = await qb.orderBy('s.useDate', 'DESC').addOrderBy('s.facilityId').addOrderBy('s.startHour', 'ASC').limit(from || to ? 5000 : 600).getRawMany();
    // 같은 신청·시설·날짜의 연속 시간은 한 줄로 합친다
    const out: any[] = [];
    for (const r of raw) {
      const prev = out.find((o) => o._app === r.applicationId && o.facilityName === r.facilityName && o.date === r.date && o.endHour === Number(r.startHour));
      if (prev) { prev.endHour = Number(r.startHour) + 1; continue; }
      out.push({
        _app: r.applicationId, date: r.date, startHour: Number(r.startHour), endHour: Number(r.startHour) + 1, facilityName: r.facilityName,
        orgName: r.orgName, repNameMasked: maskName(r.repName), requestedPeople: null,
      });
    }
    return out.map(({ _app, ...rest }) => rest);
  }

  // ---- 대시보드 ----
  async dashboard() {
    const p = await this.findPeriod();
    const today = kstDate(new Date());
    const evidencePending = await this.ds.getRepository(Evidence).countBy({ status: '대기' });
    const bos: any[] = await this.ds.getRepository(Blackout).createQueryBuilder('b')
      .leftJoin(Facility, 'f', 'f.facilityId = b.facilityId')
      .select(['b.blackoutId AS "blackoutId"', 'b.facilityId AS "facilityId"', `COALESCE(f.name, '전체') AS "facilityName"`, "to_char(b.startDate, 'YYYY-MM-DD') AS \"startDate\"", "to_char(b.endDate, 'YYYY-MM-DD') AS \"endDate\"", 'b.reasonType AS "reasonType"', 'b.reason AS "reason"'])
      .where('b.endDate >= :today', { today }).orderBy('b.startDate', 'ASC').limit(3).getRawMany();
    let period: any = null;
    let applicationsCount = 0, slotsCount = 0, onlineCount = 0, visitCount = 0;
    if (p) {
      const run = await this.ds.getRepository(DrawRun).findOneBy({ periodId: p.periodId });
      period = {
        periodId: p.periodId, targetMonth: p.targetMonth, openAt: p.openAt, closeAt: p.closeAt, drawAt: p.drawAt, announceAt: p.announceAt,
        status: this.statusOf(p, !!run), resultPublished: p.resultPublished, drawId: run?.drawId ?? null,
      };
      const apps = await this.ds.getRepository(Application).findBy({ periodId: p.periodId });
      applicationsCount = apps.length;
      onlineCount = apps.filter((a) => a.via === 'online').length;
      visitCount = apps.filter((a) => a.via === 'visit').length;
      slotsCount = await this.ds.getRepository(ApplicationSlot).createQueryBuilder('s')
        .innerJoin(Application, 'a', 'a.applicationId = s.applicationId').where('a.periodId = :pid', { pid: p.periodId }).getCount();
    }
    return { period, applicationsCount, slotsCount, onlineCount, visitCount, evidencePending, upcomingBlackouts: bos };
  }
}
