import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard, CurrentUser, Roles, type AuthUser } from '../../common/auth.js';
import { ApplicationsService } from './applications.service.js';

@Controller()
@UseGuards(AuthGuard)
@Roles('applicant')
export class ApplicantController {
  constructor(private s: ApplicationsService) {}

  @Post('quote') @HttpCode(200)
  async quote(@CurrentUser() u: AuthUser, @Body() b: any) {
    return this.s.quote(await this.s.orgOfMember(u.memberId), b);
  }

  @Post('applications')
  async create(@CurrentUser() u: AuthUser, @Body() b: any) {
    return this.s.create(await this.s.orgOfMember(u.memberId), b, 'online', null);
  }

  @Post('applications/:id/evidence')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 40 * 1024 * 1024 } }))
  async evidence(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @UploadedFile() file: any) {
    return this.s.uploadEvidence(await this.s.orgOfMember(u.memberId), id, file);
  }

  @Get('applications/me')
  async mine(@CurrentUser() u: AuthUser) {
    return this.s.myList(await this.s.orgOfMember(u.memberId));
  }

  @Get('applications/me/:id')
  async mineDetail(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) {
    return this.s.myDetail(await this.s.orgOfMember(u.memberId), id);
  }
}
