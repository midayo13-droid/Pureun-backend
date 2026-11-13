import { CanActivate, ExecutionContext, Global, Injectable, Module, SetMetadata, createParamDecorator } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { fail } from './errors.js';

export interface AuthUser { memberId: number; role: 'applicant' | 'admin'; }

export const ROLES_KEY = 'roles';
/** @Roles('admin') — 컨트롤러·메서드에 붙이면 해당 역할만 통과 */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/** 사용법: @UseGuards(AuthGuard) 그리고 필요하면 @Roles('admin'). req.user에 { memberId, role }이 들어간다. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private jwt: JwtService, private reflector: Reflector) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const h: string = req.headers['authorization'] ?? '';
    const token = h.startsWith('Bearer ') ? h.slice(7) : '';
    if (!token) fail(401, 'MSG-20', '로그인이 필요합니다.');
    try {
      const p = await this.jwt.verifyAsync(token);
      req.user = { memberId: p.sub, role: p.role } as AuthUser;
    } catch {
      fail(401, 'MSG-20', '로그인이 필요합니다.');
    }
    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (roles && roles.length && !roles.includes(req.user.role)) fail(403, 'MSG-20');
    return true;
  }
}

/** @CurrentUser() user: AuthUser */
export const CurrentUser = createParamDecorator((_d: unknown, ctx: ExecutionContext): AuthUser => ctx.switchToHttp().getRequest().user);

/** 토큰 만들기: jwt.signAsync({ sub: memberId, role }, { expiresIn: '12h' }) */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (c: ConfigService) => ({ secret: c.get<string>('JWT_SECRET'), signOptions: { expiresIn: '12h' } }),
    }),
  ],
  providers: [AuthGuard],
  exports: [JwtModule, AuthGuard],
})
export class CommonModule {}
