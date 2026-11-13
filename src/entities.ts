import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

const num = {
  to: (v?: number | null) => v,
  from: (v?: string | null) => (v === null || v === undefined ? v : Number(v)),
};

@Entity('member')
export class Member {
  @PrimaryGeneratedColumn('increment') memberId: number;
  @Index({ unique: true }) @Column({ type: 'text' }) phone: string;
  @Column({ type: 'text' }) passwordHash: string;
  @Column({ type: 'text' }) repName: string;
  @Column({ type: 'text', default: 'applicant' }) role: string; // applicant | admin
  @Column({ type: 'int', default: 0 }) failedLoginCount: number;
  @Column({ type: 'timestamptz', nullable: true }) lockedUntil: Date | null;
  @Column({ type: 'timestamptz', nullable: true }) privacyConsentAt: Date | null;
  @CreateDateColumn({ type: 'timestamptz' }) createdAt: Date;
}

@Entity('org')
export class Org {
  @PrimaryGeneratedColumn('increment') orgId: number;
  @Index({ unique: true }) @Column({ type: 'int', nullable: true }) memberId: number | null; // 방문 신청으로만 등록된 단체는 계정이 없을 수 있다
  @Column({ type: 'text' }) orgName: string;
  @Column({ type: 'text' }) orgType: string;
  @Column({ type: 'text', default: '' }) address: string;
  @Column({ type: 'int' }) memberCount: number;
  @Column({ type: 'int' }) residentCount: number;
  @Column({ type: 'text', nullable: true }) repName: string | null; // 계정 없는 단체의 대표자
  @Column({ type: 'text', nullable: true }) repPhone: string | null;
}

@Entity('facility')
export class Facility {
  @PrimaryGeneratedColumn('increment') facilityId: number;
  @Column({ type: 'text' }) name: string;
  @Column({ type: 'int' }) capacity: number;
  @Column({ type: 'int', default: 9 }) openHour: number;
  @Column({ type: 'int', default: 21 }) closeHour: number;
}

@Entity('rate')
export class Rate {
  @PrimaryGeneratedColumn('increment') rateId: number;
  @Column({ type: 'int' }) facilityId: number;
  @Column({ type: 'text' }) residentType: string; // 구민 | 비구민
  @Column({ type: 'text' }) dayType: string; // 평일 | 주말·공휴일
  @Column({ type: 'int' }) pricePerHour: number;
}

@Entity('discount_type')
export class DiscountType {
  @PrimaryGeneratedColumn('increment') discountTypeId: number;
  @Index({ unique: true }) @Column({ type: 'text' }) name: string;
  @Column({ type: 'numeric', precision: 3, scale: 2, transformer: num }) discountRate: number;
  @Column({ type: 'text', default: '' }) docRequirement: string;
}

@Entity('intake_period')
export class IntakePeriod {
  @PrimaryGeneratedColumn('increment') periodId: number;
  @Index({ unique: true }) @Column({ type: 'text' }) targetMonth: string; // YYYY-MM
  @Column({ type: 'timestamptz' }) openAt: Date;
  @Column({ type: 'timestamptz' }) closeAt: Date;
  @Column({ type: 'timestamptz' }) drawAt: Date;
  @Column({ type: 'timestamptz' }) announceAt: Date;
  @Column({ type: 'boolean', default: false }) resultPublished: boolean;
  // status(예정|접수중|마감|추첨완료)는 시각과 추첨 기록으로 계산한다
}

@Entity('blackout')
export class Blackout {
  @PrimaryGeneratedColumn('increment') blackoutId: number;
  @Column({ type: 'int', nullable: true }) facilityId: number | null; // null이면 전체 시설
  @Column({ type: 'date' }) startDate: string;
  @Column({ type: 'date' }) endDate: string;
  @Column({ type: 'text' }) reasonType: string; // 공사 | 행사 | 안전점검 | 휴관
  @Column({ type: 'text' }) reason: string;
  @Column({ type: 'int', nullable: true }) registeredBy: number | null;
  @CreateDateColumn({ type: 'timestamptz' }) registeredAt: Date;
}

@Entity('application')
export class Application {
  @PrimaryGeneratedColumn('increment') applicationId: number;
  @Index({ unique: true }) @Column({ type: 'text' }) applicationNo: string; // A-2026-000123
  @Column({ type: 'int' }) periodId: number;
  @Column({ type: 'int' }) orgId: number;
  @Column({ type: 'text', default: 'online' }) via: string; // online | visit
  @Column({ type: 'int', nullable: true }) enteredBy: number | null;
  @Column({ type: 'timestamptz' }) appliedAt: Date;
  @Column({ type: 'int', nullable: true }) discountTypeId: number | null;
  @Column({ type: 'boolean', default: false }) isResidentSnapshot: boolean;
  @Column({ type: 'timestamptz', nullable: true }) privacyConsentAt: Date | null;
  @Column({ type: 'text', default: '접수' }) status: string; // 접수 | 추첨완료 | 취소
}

@Entity('application_slot')
@Index(['facilityId', 'useDate', 'startHour'], { unique: true, where: `"result" = '당첨'` })
@Index(['orgId', 'facilityId', 'useDate', 'startHour'], { unique: true })
export class ApplicationSlot {
  @PrimaryGeneratedColumn('increment') slotId: number;
  @Index() @Column({ type: 'int' }) applicationId: number;
  @Column({ type: 'int' }) orgId: number;
  @Column({ type: 'int' }) facilityId: number;
  @Column({ type: 'date' }) useDate: string;
  @Column({ type: 'int' }) startHour: number;
  @Column({ type: 'boolean', default: false }) isRegular: boolean;
  @Column({ type: 'text', default: '대기' }) result: string; // 대기 | 당첨 | 탈락 | 취소
  @Column({ type: 'int', nullable: true }) drawId: number | null;
  @Column({ type: 'text', nullable: true }) reasonText: string | null;
  @Column({ type: 'int', default: 0 }) pricePerHour: number;
  @Column({ type: 'int', default: 0 }) discountAmount: number;
  @Column({ type: 'int', default: 0 }) netAmount: number;
}

@Entity('evidence')
export class Evidence {
  @PrimaryGeneratedColumn('increment') evidenceId: number;
  @Index() @Column({ type: 'int' }) applicationId: number;
  @Column({ type: 'text' }) filePath: string;
  @Column({ type: 'text', default: '' }) fileName: string;
  @Column({ type: 'text', default: '대기' }) status: string; // 대기 | 승인 | 반려
  @Column({ type: 'int', nullable: true }) reviewedBy: number | null;
  @Column({ type: 'timestamptz', nullable: true }) reviewedAt: Date | null;
  @Column({ type: 'text', nullable: true }) rejectReason: string | null;
  @CreateDateColumn({ type: 'timestamptz' }) submittedAt: Date;
}

@Entity('draw_run')
export class DrawRun {
  @PrimaryGeneratedColumn('increment') drawId: number;
  @Index({ unique: true }) @Column({ type: 'int' }) periodId: number; // 접수 기간당 한 번만
  @Column({ type: 'timestamptz' }) runAt: Date;
  @Column({ type: 'int', nullable: true }) runBy: number | null;
  @Column({ type: 'text', default: 'v1' }) ruleVersion: string;
  @Column({ type: 'text', default: '' }) randomRecord: string; // 내부 관리, 화면 비공개
  @Column({ type: 'int', default: 0 }) totalApplications: number;
  @Column({ type: 'int', default: 0 }) totalSlots: number;
}

@Entity('draw_slot_log')
export class DrawSlotLog {
  @PrimaryGeneratedColumn('increment') logId: number;
  @Index() @Column({ type: 'int' }) drawId: number;
  @Column({ type: 'int' }) facilityId: number;
  @Column({ type: 'date' }) useDate: string;
  @Column({ type: 'int' }) startHour: number;
  @Column({ type: 'int' }) applicantCount: number;
  @Column({ type: 'int', nullable: true }) winnerApplicationId: number | null;
  @Column({ type: 'text' }) method: string; // 단독선정 | 무작위추첨 | 공석
}

@Entity('regulation_clause')
export class RegulationClause {
  @PrimaryGeneratedColumn('increment') clauseId: number;
  @Column({ type: 'text' }) doc: string; // 조례 | 규정 | 안내
  @Column({ type: 'text' }) articleLabel: string; // 제22조 / 별표 1 / 부칙
  @Column({ type: 'text' }) title: string;
  @Column({ type: 'text' }) body: string;
  @Column({ type: 'int' }) priority: number; // 1 조례, 2 규정
  @Column({ type: 'int', default: 0 }) seq: number;
}

@Entity('qa_log')
export class QaLog {
  @PrimaryGeneratedColumn('increment') qaId: number;
  @Column({ type: 'timestamptz', default: () => 'now()' }) askedAt: Date;
  @Column({ type: 'text' }) question: string;
  @Column({ type: 'text', default: '' }) citedClauseIds: string;
  @Column({ type: 'text', default: '검색만' }) answeredBy: string;
}

@Entity('access_log')
export class AccessLog {
  @PrimaryGeneratedColumn('increment') accessId: number;
  @Column({ type: 'int' }) adminId: number;
  @Column({ type: 'text' }) targetType: string; // 신청 | 증빙 | 회원
  @Column({ type: 'int' }) targetId: number;
  @Column({ type: 'timestamptz', default: () => 'now()' }) viewedAt: Date;
}

export const ALL_ENTITIES = [
  Member, Org, Facility, Rate, DiscountType, IntakePeriod, Blackout, Application, ApplicationSlot,
  Evidence, DrawRun, DrawSlotLog, RegulationClause, QaLog, AccessLog,
];
