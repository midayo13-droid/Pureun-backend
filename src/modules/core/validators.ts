import { AppError, fail } from '../../common/errors.js';

export const ORG_TYPES = ['일반 동호회', '장애인 단체', '국가유공자 단체', '구 소재 학교', '노인 단체'];

export function normPhone(p: unknown): string {
  return String(p ?? '').replace(/\D/g, '');
}

/** 단체 입력 검증(회원 가입·방문 대리 입력 공통). 오류 시 throw */
export function validateOrgInput(b: any, fields: Record<string, string> = {}) {
  if (!b.orgName || !String(b.orgName).trim()) fields.orgName = '단체명을 입력해 주세요.';
  if (!ORG_TYPES.includes(b.orgType)) fields.orgType = '단체 유형을 선택해 주세요.';
  if (!b.address || !String(b.address).trim()) fields.address = '단체 주소를 입력해 주세요.';
  const mc = Number(b.memberCount);
  const rc = Number(b.residentCount);
  if (!Number.isInteger(mc) || mc < 5) throw new AppError(400, 'MSG-03', '5인 이상 단체만 신청할 수 있습니다.', { ...fields, memberCount: '5인 이상 단체만 신청할 수 있습니다.' });
  if (!Number.isInteger(rc) || rc < 0 || rc > mc) throw new AppError(400, 'MSG-04', '구민 회원 수는 전체 회원 수보다 클 수 없습니다.', { ...fields, residentCount: '구민 회원 수는 전체 회원 수보다 클 수 없습니다.' });
  if (Object.keys(fields).length) throw new AppError(400, 'MSG-21', '입력 내용을 확인해 주세요.', fields);
  return { orgName: String(b.orgName).trim(), orgType: b.orgType as string, address: String(b.address).trim(), memberCount: mc, residentCount: rc };
}

export function requireConsent(b: any) {
  if (b.privacyConsent !== true) fail(400, 'MSG-01', '', { privacyConsent: '개인정보 처리에 동의해 주세요.' });
}
