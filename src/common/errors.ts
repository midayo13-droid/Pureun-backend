import { HttpException } from '@nestjs/common';

/** 오류 응답: { statusCode, code:'MSG-xx', message, fields? } — API_계약.md 공통 규칙 */
export class AppError extends HttpException {
  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super({ statusCode: status, code, message, ...(fields ? { fields } : {}) }, status);
  }
}

/** 기능명세서 10장 메시지. 문구 안의 ○는 호출하는 쪽에서 채워 넣는다. */
export const MSG: Record<string, string> = {
  'MSG-01': '개인정보 처리에 동의해야 진행할 수 있습니다.',
  'MSG-02': '이미 가입된 휴대전화 번호입니다.',
  'MSG-03': '5인 이상 단체만 신청할 수 있습니다.',
  'MSG-04': '구민 회원 수는 전체 회원 수보다 클 수 없습니다.',
  'MSG-05': '비밀번호는 8자 이상이며 영문·숫자·특수문자를 모두 포함해야 합니다.',
  'MSG-06': '휴대전화 번호 또는 비밀번호가 올바르지 않습니다.',
  'MSG-07': '로그인에 여러 번 실패해 10분간 사용할 수 없습니다.',
  'MSG-08': '접수 기간이 아닙니다.',
  'MSG-09': '선택한 시간 중 이용할 수 없는 시간이 있습니다.',
  'MSG-10': '이미 같은 시간에 신청하셨습니다.',
  'MSG-11': '정기 대관은 같은 시설에서 한 주에 2회까지만 신청할 수 있습니다.',
  'MSG-12': '감면을 신청하려면 증빙 서류를 올려야 합니다.',
  'MSG-13': 'PDF, JPG, PNG 파일만 올릴 수 있고 파일당 10MB까지입니다.',
  'MSG-14': '접수가 마감된 뒤에 추첨할 수 있습니다.',
  'MSG-15': '이 접수 기간은 이미 추첨했습니다.',
  'MSG-16': '반려 사유를 입력해 주세요.',
  'MSG-17': '규정에서 근거를 찾지 못했습니다. 센터 담당자에게 문의하세요.',
  'MSG-18': '개인정보가 포함된 것 같습니다. 번호 등 개인정보는 지우고 다시 질문해 주세요.',
  'MSG-19': '답변을 만들지 못해 관련 규정 원문만 보여드립니다.',
  'MSG-20': '이 화면을 볼 권한이 없습니다.',
  'MSG-21': '일시적인 문제가 생겼습니다. 잠시 후 다시 시도해 주세요. 입력한 내용은 유지됩니다.',
};

export function fail(status: number, code: string, extra = '', fields?: Record<string, string>): never {
  throw new AppError(status, code, `${MSG[code] ?? ''}${extra ? ' ' + extra : ''}`.trim(), fields);
}
