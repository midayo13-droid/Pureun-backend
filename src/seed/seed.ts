import 'reflect-metadata';
import 'dotenv/config';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DataSource } from 'typeorm';
import bcrypt from 'bcryptjs';
import {
  ALL_ENTITIES, Application, ApplicationSlot, Blackout, DiscountType, DrawRun, DrawSlotLog, Evidence, Facility,
  IntakePeriod, Member, Org, Rate, RegulationClause,
} from '../entities.js';

const dataDir = path.join(import.meta.dirname, '..', '..', 'seed-data');
const readJson = (n: string): any[] => JSON.parse(readFileSync(path.join(dataDir, n), 'utf-8'));

// 결정적 난수(같은 시드 -> 같은 결과)
function mulberry32(a: number) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261113);

const SURNAMES = ['김', '이', '박', '최', '정', '강', '조', '윤', '장', '임', '한', '오', '서', '신', '권', '황', '안', '송', '류', '홍'];
const GIVEN = ['민준', '서연', '지후', '하윤', '도윤', '서준', '예은', '지민', '수빈', '주원', '현우', '지우', '유진', '건우', '소영', '태양', '나윤', '시우', '은서', '재민', '다은', '승현', '미래', '동혁', '보람'];

// 날짜 도구 (한국 시간 기준 문자열)
const KST = 9 * 3600 * 1000;
const kstDate = (d: Date) => new Date(d.getTime() + KST).toISOString().slice(0, 10);
const at = (date: string, h: number, m = 0) => new Date(`${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+09:00`);
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10);
};
const dow = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 일
const isWeekend = (date: string) => dow(date) === 0 || dow(date) === 6;
const nextBizDay = (date: string) => { let d = date; while (isWeekend(d)) d = addDays(d, 1); return d; };
const prevMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7); };
const nextMonth = (ym: string) => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7); };
const pad6 = (n: number) => String(n).padStart(6, '0');
const chunk = <T>(a: T[], n: number) => { const r: T[][] = []; for (let i = 0; i < a.length; i += n) r.push(a.slice(i, i + n)); return r; };

async function main() {
  const schema = process.env.DB_SCHEMA ?? 'rental';
  if (!/^[a-z_][a-z0-9_]*$/.test(schema)) throw new Error('DB_SCHEMA 값이 올바르지 않습니다.');
  const ds = new DataSource({
    type: 'postgres', url: process.env.DATABASE_URL, schema, ssl: { rejectUnauthorized: false },
    entities: ALL_ENTITIES, synchronize: false,
  });
  await ds.initialize();
  await ds.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  await ds.synchronize();

  // rental 스키마의 테이블만 비운다
  const tables = ds.entityMetadatas.map((m) => `"${schema}"."${m.tableName}"`).join(', ');
  await ds.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);

  const now = new Date();
  const rentals = readJson('rentals.json');
  const orgRows = readJson('orgs.json');
  const blackoutRows = readJson('blackouts.json');
  const clauseRows = readJson('clauses.json');

  // 1. 시설·요금·감면 유형
  const facSpec = [['실내체육관', 120], ['다목적실A', 30], ['다목적실B', 30], ['풋살장', 40]] as const;
  const facs = await ds.getRepository(Facility).save(facSpec.map(([name, capacity]) => ({ name, capacity, openHour: 9, closeHour: 21 }) as Facility));
  const facId: Record<string, number> = Object.fromEntries(facs.map((f) => [f.name, f.facilityId]));
  const price: Record<string, [number, number, number, number]> = { // 구민평일, 구민주말, 비구민평일, 비구민주말
    실내체육관: [30000, 40000, 45000, 60000], 다목적실A: [10000, 15000, 15000, 22500],
    다목적실B: [10000, 15000, 15000, 22500], 풋살장: [40000, 60000, 60000, 90000],
  };
  const rates: Partial<Rate>[] = [];
  for (const f of facs) {
    const p = price[f.name];
    rates.push({ facilityId: f.facilityId, residentType: '구민', dayType: '평일', pricePerHour: p[0] },
      { facilityId: f.facilityId, residentType: '구민', dayType: '주말·공휴일', pricePerHour: p[1] },
      { facilityId: f.facilityId, residentType: '비구민', dayType: '평일', pricePerHour: p[2] },
      { facilityId: f.facilityId, residentType: '비구민', dayType: '주말·공휴일', pricePerHour: p[3] });
  }
  await ds.getRepository(Rate).insert(rates);
  const dts = await ds.getRepository(DiscountType).save([
    { name: '장애인 단체', discountRate: 0.5, docRequirement: '장애인 단체 등록 확인서 또는 회원 과반의 장애인 등록 확인서, 회원 명부' },
    { name: '국가유공자 단체', discountRate: 0.5, docRequirement: '국가유공자 단체 등록 확인서 또는 회원 과반의 유공자(유족) 확인서, 회원 명부' },
    { name: '구 소재 학교', discountRate: 0.3, docRequirement: '학교장 명의 공문(교육 활동 목적 확인)' },
    { name: '노인 단체', discountRate: 0.3, docRequirement: '노인 단체 등록 확인서, 65세 이상 회원이 과반인 회원 명부' },
  ] as DiscountType[]);
  const dtId: Record<string, number> = Object.fromEntries(dts.map((d) => [d.name, d.discountTypeId]));
  const dtRate: Record<string, number> = Object.fromEntries(dts.map((d) => [d.name, d.discountRate]));

  // 2. 규정 조항
  await ds.getRepository(RegulationClause).insert(clauseRows.map((c, i) => ({ doc: c.doc, articleLabel: c.articleLabel, title: c.title, body: c.body, priority: c.priority, seq: i + 1 })));

  // 3. 계정·단체
  const ADMIN_PW = 'Admin#2026!';
  const DEMO_PW = 'Demo#2026!';
  const adminHash = await bcrypt.hash(ADMIN_PW, 8);
  const demoHash = await bcrypt.hash(DEMO_PW, 8);
  const admin = await ds.getRepository(Member).save({ phone: '0105550000', passwordHash: adminHash, repName: '오주무관', role: 'admin', privacyConsentAt: now } as Member);
  const usedNames = new Set<string>();
  const members: Partial<Member>[] = orgRows.map((_o, i) => {
    let name: string;
    do { name = SURNAMES[Math.floor(rnd() * SURNAMES.length)] + GIVEN[Math.floor(rnd() * GIVEN.length)]; } while (usedNames.has(name) && usedNames.size < 400);
    usedNames.add(name);
    return { phone: `0105550${String(i + 1).padStart(3, '0')}`, passwordHash: demoHash, repName: name, role: 'applicant', privacyConsentAt: new Date('2026-03-01T09:00:00+09:00') };
  });
  const savedMembers = await ds.getRepository(Member).save(members as Member[]);
  const orgs = await ds.getRepository(Org).save(orgRows.map((o, i) => ({
    memberId: savedMembers[i].memberId, orgName: o['단체명'], orgType: o['단체유형'], address: '푸른구',
    memberCount: o['회원 수'], residentCount: o['구민 회원 수'], repName: null, repPhone: null,
  }) as Org));
  const orgByCode: Record<string, Org> = Object.fromEntries(orgRows.map((o, i) => [o['단체ID'], orgs[i]]));

  // 4. 과거 6개월
  const months = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
  const periodByMonth: Record<string, IntakePeriod> = {};
  const runByMonth: Record<string, DrawRun> = {};
  const byMonth: Record<string, any[]> = Object.fromEntries(months.map((m) => [m, [] as any[]]));
  for (const r of rentals) byMonth[r['이용월']].push(r);
  for (const m of months) {
    const pm = prevMonth(m);
    const close = nextBizDay(`${pm}-05`);
    const draw = nextBizDay(addDays(close, 1));
    periodByMonth[m] = await ds.getRepository(IntakePeriod).save({
      targetMonth: m, openAt: at(`${pm}-01`, 9), closeAt: at(close, 18), drawAt: at(draw, 10), announceAt: at(draw, 18), resultPublished: true,
    } as IntakePeriod);
    const rows = byMonth[m];
    const slotKeys = new Set<string>();
    for (const r of rows) {
      const h = parseInt(String(r['시작시각']).slice(0, 2), 10);
      for (let k = 0; k < r['이용시간']; k++) slotKeys.add(`${r['시설']}|${r['이용일']}|${h + k}`);
    }
    runByMonth[m] = await ds.getRepository(DrawRun).save({
      periodId: periodByMonth[m].periodId, runAt: at(draw, 10), runBy: admin.memberId, ruleVersion: 'v1',
      randomRecord: Array.from({ length: 8 }, () => Math.floor(rnd() * 1e9).toString(16)).join('-'),
      totalApplications: rows.length, totalSlots: slotKeys.size,
    } as DrawRun);
  }

  const yearSeq: Record<string, number> = {};
  const nextNo = (appliedAt: Date) => {
    const y = kstDate(appliedAt).slice(0, 4);
    yearSeq[y] = (yearSeq[y] ?? 0) + 1;
    return `A-${y}-${pad6(yearSeq[y])}`;
  };
  const CANCEL = new Set(['취소', '센터취소', '결제기한초과취소']);
  const sorted = [...rentals].sort((a, b) => String(a['신청일시']).localeCompare(String(b['신청일시'])));
  const appEntities = sorted.map((r) => {
    const org = orgByCode[r['단체ID']];
    const appliedAt = new Date(`${r['신청일시']}+09:00`);
    return {
      applicationNo: nextNo(appliedAt), periodId: periodByMonth[r['이용월']].periodId, orgId: org.orgId,
      via: r['접수경로'] === '방문' ? 'visit' : 'online', enteredBy: r['접수경로'] === '방문' ? admin.memberId : null,
      appliedAt, discountTypeId: r['감면유형'] ? dtId[r['감면유형']] : null, isResidentSnapshot: r['구민단체'] === 'Y',
      privacyConsentAt: appliedAt, status: CANCEL.has(r['상태']) ? '취소' : '추첨완료',
    } as Application;
  });
  const savedApps: Application[] = [];
  for (const c of chunk(appEntities, 300)) savedApps.push(...(await ds.getRepository(Application).save(c)));

  const slots: Partial<ApplicationSlot>[] = [];
  const logs: Partial<DrawSlotLog>[] = [];
  const evidences: Partial<Evidence>[] = [];
  sorted.forEach((r, i) => {
    const app = savedApps[i];
    const n: number = r['이용시간'];
    const h0 = parseInt(String(r['시작시각']).slice(0, 2), 10);
    const disc: number = r['감면액'] ?? 0;
    const net: number = r['청구액'] ?? 0;
    const run = runByMonth[r['이용월']];
    const cancelled = CANCEL.has(r['상태']);
    for (let k = 0; k < n; k++) {
      const last = k === n - 1;
      const d = last ? disc - Math.floor(disc / n) * (n - 1) : Math.floor(disc / n);
      const nt = last ? net - Math.floor(net / n) * (n - 1) : Math.floor(net / n);
      slots.push({
        applicationId: app.applicationId, orgId: app.orgId, facilityId: facId[r['시설']], useDate: r['이용일'], startHour: h0 + k,
        isRegular: r['정기대관'] === 'Y', result: cancelled ? '취소' : '당첨', drawId: run.drawId, reasonText: r['선정사유'] ?? null,
        pricePerHour: r['시간당요금'] ?? 0, discountAmount: d, netAmount: nt,
      });
      const method = r['선정방식'] === '추첨당첨' ? '무작위추첨' : '단독선정';
      logs.push({ drawId: run.drawId, facilityId: facId[r['시설']], useDate: r['이용일'], startHour: h0 + k, applicantCount: r['경쟁건수'] ?? 1, winnerApplicationId: app.applicationId, method });
    }
    if (r['증빙상태'] === '확인완료') {
      evidences.push({
        applicationId: app.applicationId, filePath: 'seed/dummy.pdf', fileName: '증빙서류_가상.pdf', status: '승인',
        reviewedBy: admin.memberId, reviewedAt: r['추첨일시'] ? new Date(`${r['추첨일시']}+09:00`) : run.runAt,
      });
    }
  });

  // 5. 지금 접수 중인 기간 + 시연 신청
  const targetMonth = nextMonth(kstDate(now).slice(0, 7));
  const openAt = new Date(now.getTime() - 86400000);
  const closeAt = new Date(now.getTime() + 4 * 86400000);
  const drawDay = addDays(kstDate(closeAt), 1);
  if (months.includes(targetMonth)) throw new Error(`접수 기간 ${targetMonth}가 과거 데이터와 겹칩니다.`);
  const cur = await ds.getRepository(IntakePeriod).save({ targetMonth, openAt, closeAt, drawAt: at(drawDay, 10), announceAt: at(drawDay, 18), resultPublished: false } as IntakePeriod);

  const validDays = Array.from({ length: 31 }, (_, i) => `${targetMonth}-${String(i + 1).padStart(2, '0')}`)
    .filter((d) => new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d);
  const weekdays = validDays.filter((d) => !isWeekend(d));
  const sats = validDays.filter((d) => dow(d) === 6);
  const suns = validDays.filter((d) => dow(d) === 0);
  const bo: Partial<Blackout>[] = [
    { facilityId: facId['다목적실B'], startDate: weekdays[5], endDate: weekdays[7], reasonType: '공사', reason: '바닥 보수 공사', registeredBy: admin.memberId },
    { facilityId: null, startDate: weekdays[14], endDate: weekdays[14], reasonType: '안전점검', reason: '정기 안전 점검', registeredBy: admin.memberId },
    { facilityId: facId['실내체육관'], startDate: weekdays[18], endDate: weekdays[18], reasonType: '행사', reason: '푸른구 생활체육 한마당 행사', registeredBy: admin.memberId },
  ];
  for (const b of blackoutRows) {
    bo.push({
      facilityId: b['시설'] === '전체' ? null : facId[b['시설']], startDate: b['시작일'], endDate: b['종료일'],
      reasonType: b['사유 분류'] === '우천' ? '휴관' : b['사유 분류'], reason: b['사유'], registeredBy: admin.memberId,
    });
  }
  await ds.getRepository(Blackout).insert(bo);

  const general = orgRows.filter((o) => o['단체유형'] === '일반 동호회').map((o) => orgByCode[o['단체ID']]);
  const discOrgs = orgRows.filter((o) => o['감면 유형']).map((o) => ({ org: orgByCode[o['단체ID']], dt: o['감면 유형'] as string }));
  type Demo = { org: Org; slots: [string, string, number][]; regular?: boolean; dt?: string; ev?: '대기' | '승인'; visit?: boolean };
  const G = (i: number) => general[i];
  const demos: Demo[] = [
    { org: G(0), regular: true, slots: [['풋살장', sats[0], 10], ['풋살장', sats[0], 11]] },
    { org: G(1), slots: [['풋살장', sats[0], 10]] },
    { org: G(2), regular: true, slots: [['풋살장', sats[0], 10]] },
    { org: G(3), slots: [['풋살장', sats[0], 10], ['풋살장', sats[0], 11]] },
    { org: G(4), slots: [['풋살장', sats[0], 10]] },
    { org: G(5), slots: [['실내체육관', suns[0], 9], ['실내체육관', suns[0], 10]] },
    { org: G(6), slots: [['실내체육관', suns[0], 9], ['실내체육관', suns[0], 10]] },
    { org: G(7), slots: [['실내체육관', suns[0], 9]] },
    { org: G(8), slots: [['풋살장', suns[0], 9]] },
    { org: G(9), slots: [['풋살장', suns[0], 9]] },
    { org: G(10), slots: [['실내체육관', sats[1], 10], ['실내체육관', sats[1], 11], ['실내체육관', sats[1], 12]] },
    { org: G(11), slots: [['다목적실A', sats[1], 9], ['다목적실A', sats[1], 10]] },
    { org: G(12), slots: [['풋살장', sats[1], 14]] },
    { org: G(13), slots: [['실내체육관', suns[1], 9], ['실내체육관', suns[1], 10]] },
    { org: G(14), slots: [['실내체육관', suns[1], 9], ['실내체육관', suns[1], 10]] },
    { org: G(15), slots: [['다목적실B', sats[2], 13], ['다목적실B', sats[2], 14]] },
    { org: G(16), slots: [['풋살장', sats[2], 9]] },
    { org: G(21), regular: true, slots: [['실내체육관', weekdays[9], 18], ['실내체육관', weekdays[11], 18]] },
    { org: G(22), regular: true, slots: [['풋살장', weekdays[10], 19], ['풋살장', weekdays[11], 19]] },
    { org: discOrgs[0].org, dt: discOrgs[0].dt, ev: '대기', slots: [['실내체육관', sats[0], 13], ['실내체육관', sats[0], 14]] },
    { org: discOrgs[4].org, dt: discOrgs[4].dt, ev: '대기', slots: [['다목적실A', suns[0], 10]] },
    { org: discOrgs[8].org, dt: discOrgs[8].dt, ev: '대기', slots: [['다목적실B', sats[1], 9]] },
    { org: discOrgs[12].org, dt: discOrgs[12].dt, ev: '승인', slots: [['실내체육관', sats[2], 9]] },
    { org: discOrgs[15].org, dt: discOrgs[15].dt, ev: '대기', slots: [['다목적실A', sats[2], 10]] },
    { org: G(17), visit: true, slots: [['다목적실A', sats[1], 13]] },
    { org: G(18), visit: true, slots: [['풋살장', suns[1], 11]] },
    { org: G(19), visit: true, slots: [['다목적실B', suns[1], 14]] },
  ];
  const nowMs = now.getTime();
  const demoApps: Application[] = demos.map((d, i) => {
    const appliedAt = new Date(openAt.getTime() + ((nowMs - openAt.getTime()) * (i + 1)) / (demos.length + 2));
    return {
      applicationNo: nextNo(appliedAt), periodId: cur.periodId, orgId: d.org.orgId, via: d.visit ? 'visit' : 'online',
      enteredBy: d.visit ? admin.memberId : null, appliedAt, discountTypeId: d.dt ? dtId[d.dt] : null,
      isResidentSnapshot: d.org.residentCount * 2 >= d.org.memberCount, privacyConsentAt: appliedAt, status: '접수',
    } as Application;
  });
  const savedDemo = await ds.getRepository(Application).save(demoApps);
  demos.forEach((d, i) => {
    const app = savedDemo[i];
    for (const [fname, date, hour] of d.slots) {
      const p = price[fname];
      const pph = p[(app.isResidentSnapshot ? 0 : 2) + (isWeekend(date) ? 1 : 0)];
      const disc = d.ev === '승인' && d.dt ? Math.round(pph * dtRate[d.dt]) : 0;
      slots.push({
        applicationId: app.applicationId, orgId: app.orgId, facilityId: facId[fname], useDate: date, startHour: hour,
        isRegular: !!d.regular, result: '대기', drawId: null, reasonText: null, pricePerHour: pph, discountAmount: disc, netAmount: pph - disc,
      });
    }
    if (d.ev) {
      evidences.push({
        applicationId: app.applicationId, filePath: 'seed/dummy.pdf', fileName: '증빙서류_가상.pdf', status: d.ev,
        reviewedBy: d.ev === '승인' ? admin.memberId : null, reviewedAt: d.ev === '승인' ? now : null,
      });
    }
  });

  for (const c of chunk(slots, 400)) await ds.getRepository(ApplicationSlot).insert(c);
  for (const c of chunk(logs, 400)) await ds.getRepository(DrawSlotLog).insert(c);
  for (const c of chunk(evidences, 400)) await ds.getRepository(Evidence).insert(c);

  // 계정 안내 문서(평문 비밀번호는 이 파일에만)
  writeFileSync(path.join(dataDir, 'DEMO_ACCOUNTS.md'), [
    '# 시연 계정 (가상, 실습용)', '',
    `- 관리자: 휴대전화 0105550000 / 비밀번호 ${ADMIN_PW}`,
    `- 신청자(공통 비밀번호 ${DEMO_PW}): 휴대전화 0105550001 ~ 0105550${String(orgRows.length).padStart(3, '0')}`,
    '  - 0105550001: 푸른 풋살클럽(일반 동호회, 정기 대관)', '',
    `- 현재 접수 중 기간: ${targetMonth} 이용분`, '',
  ].join('\n'));

  // 6. 요약
  console.log('시드 완료');
  for (const m of ds.entityMetadatas) {
    const cnt = await ds.getRepository(m.target as any).count();
    console.log(`  ${m.tableName}: ${cnt}`);
  }
  await ds.destroy();
}
main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
