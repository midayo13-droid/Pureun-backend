import { Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import path from 'node:path';
import { AuthGuard, CurrentUser, Roles, type AuthUser } from '../../common/auth.js';
import { AdminService } from './admin.service.js';

@Controller('admin')
@UseGuards(AuthGuard)
@Roles('admin')
export class AdminController {
  constructor(private s: AdminService) {}

  @Get('applications') list(@Query() q: any) { return this.s.listApplications(q); }
  @Get('applications/:id') detail(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number) { return this.s.applicationDetail(u.memberId, id); }
  @Post('applications') createVisit(@CurrentUser() u: AuthUser, @Body() b: any) { return this.s.createVisit(u.memberId, b); }
  @Get('orgs') orgs(@Query('search') search?: string) { return this.s.listOrgs(search); }

  @Get('evidence') evidence(@Query('status') status?: string) { return this.s.listEvidence(status); }
  @Get('evidence/:id/file')
  async file(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const e = await this.s.evidenceFile(u.memberId, id);
    res.sendFile(path.resolve(e.filePath));
  }
  @Put('evidence/:id') decide(@CurrentUser() u: AuthUser, @Param('id', ParseIntPipe) id: number, @Body() b: any) { return this.s.decideEvidence(u.memberId, id, b); }

  @Get('intake') intake() { return this.s.listIntake(); }
  @Post('intake') createIntake(@Body() b: any) { return this.s.createIntake(b); }
  @Put('intake/:id') updateIntake(@Param('id', ParseIntPipe) id: number, @Body() b: any) { return this.s.updateIntake(id, b); }

  @Get('blackouts') blackouts() { return this.s.listBlackouts(); }
  @Post('blackouts') createBlackout(@CurrentUser() u: AuthUser, @Body() b: any) { return this.s.createBlackout(u.memberId, b); }
  @Delete('blackouts/:id') @HttpCode(204) deleteBlackout(@Param('id', ParseIntPipe) id: number) { return this.s.deleteBlackout(id); }
}
