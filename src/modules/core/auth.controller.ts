import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser, type AuthUser } from '../../common/auth.js';
import { AuthService } from './auth.service.js';

@Controller('auth')
export class AuthController {
  constructor(private s: AuthService) {}

  @Post('signup') signup(@Body() b: any) { return this.s.signup(b); }
  @Post('login') @HttpCode(200) login(@Body() b: any) { return this.s.login(b); }
  @Get('me') @UseGuards(AuthGuard) me(@CurrentUser() u: AuthUser) { return this.s.me(u.memberId); }
}
