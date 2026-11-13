import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import bcrypt from 'bcryptjs';
import { Member, Org } from '../../entities.js';
import { AppError, fail } from '../../common/errors.js';
import { isResidentOrg } from '../../common/pricing.js';
import { normPhone, requireConsent, validateOrgInput } from './validators.js';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Member) private members: Repository<Member>,
    @InjectRepository(Org) private orgs: Repository<Org>,
    private jwt: JwtService,
  ) {}

  async signup(b: any) {
    b = b ?? {};
    requireConsent(b);
    const fields: Record<string, string> = {};
    const repName = String(b.repName ?? '').trim();
    if ([...repName].length < 2) fields.repName = '성명은 2자 이상 입력해 주세요.';
    const phone = normPhone(b.phone);
    if (!/^010\d{8}$/.test(phone)) fields.phone = '010으로 시작하는 11자리 번호를 입력해 주세요.';
    const pw = String(b.password ?? '');
    if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw) || !/[^A-Za-z0-9]/.test(pw)) {
      throw new AppError(400, 'MSG-05', '비밀번호는 8자 이상이며 영문·숫자·특수문자를 모두 포함해야 합니다.', { password: '비밀번호는 8자 이상이며 영문·숫자·특수문자를 모두 포함해야 합니다.' });
    }
    if (pw !== b.passwordConfirm) {
      throw new AppError(400, 'MSG-05', '비밀번호 확인이 일치하지 않습니다.', { passwordConfirm: '비밀번호 확인이 일치하지 않습니다.' });
    }
    if (Object.keys(fields).length) throw new AppError(400, 'MSG-21', '입력 내용을 확인해 주세요.', fields);
    const org = validateOrgInput(b);
    if (await this.members.findOneBy({ phone })) fail(409, 'MSG-02', '', { phone: '이미 가입된 휴대전화 번호입니다.' });
    if (String(b.verifyCode ?? '') !== '123456') {
      throw new AppError(400, 'VERIFY', '인증번호가 올바르지 않습니다.', { verifyCode: '인증번호가 올바르지 않습니다.' });
    }
    const m = await this.members.save(
      this.members.create({ phone, repName, passwordHash: await bcrypt.hash(pw, 8), role: 'applicant', privacyConsentAt: new Date() }),
    );
    await this.orgs.save(this.orgs.create({ memberId: m.memberId, ...org }));
    return { memberId: m.memberId };
  }

  async login(b: any) {
    const phone = normPhone(b?.phone);
    const m = await this.members.findOneBy({ phone });
    if (!m) fail(401, 'MSG-06');
    const now = new Date();
    if (m.lockedUntil && m.lockedUntil > now) fail(423, 'MSG-07');
    if (m.lockedUntil && m.lockedUntil <= now) {
      m.lockedUntil = null;
      m.failedLoginCount = 0;
    }
    const ok = await bcrypt.compare(String(b?.password ?? ''), m.passwordHash);
    if (!ok) {
      m.failedLoginCount += 1;
      if (m.failedLoginCount >= 5) {
        m.lockedUntil = new Date(Date.now() + 10 * 60 * 1000);
        m.failedLoginCount = 0;
        await this.members.save(m);
        fail(423, 'MSG-07');
      }
      await this.members.save(m);
      fail(401, 'MSG-06');
    }
    m.failedLoginCount = 0;
    m.lockedUntil = null;
    await this.members.save(m);
    const org = await this.orgs.findOneBy({ memberId: m.memberId });
    const token = await this.jwt.signAsync({ sub: m.memberId, role: m.role });
    return { token, user: { memberId: m.memberId, role: m.role, repName: m.repName, orgName: org?.orgName ?? null } };
  }

  async me(memberId: number) {
    const m = await this.members.findOneBy({ memberId });
    if (!m) fail(401, 'MSG-20', '로그인이 필요합니다.');
    const o = await this.orgs.findOneBy({ memberId });
    return {
      memberId: m.memberId,
      role: m.role,
      repName: m.repName,
      phone: m.phone,
      org: o
        ? { orgId: o.orgId, orgName: o.orgName, orgType: o.orgType, address: o.address, memberCount: o.memberCount, residentCount: o.residentCount, isResidentOrg: isResidentOrg(o.memberCount, o.residentCount) }
        : null,
    };
  }
}
