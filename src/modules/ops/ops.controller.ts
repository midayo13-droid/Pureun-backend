import { Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, CurrentUser, Roles } from '../../common/auth.js';
import type { AuthUser } from '../../common/auth.js';
import { OpsService } from './ops.service.js';

@Controller('admin')
@UseGuards(AuthGuard)
@Roles('admin')
export class OpsController {
  constructor(private readonly ops: OpsService) {}

  @Get('draw/summary')
  summary(@Query('periodId') periodId?: string) {
    return this.ops.summary(periodId ? Number(periodId) : undefined);
  }

  @Post('draw')
  run(@Body() body: { periodId?: number }, @CurrentUser() user: AuthUser) {
    return this.ops.runDraw(Number(body?.periodId), user.memberId);
  }

  @Post('draw/:drawId/publish')
  publish(@Param('drawId', ParseIntPipe) drawId: number) {
    return this.ops.publish(drawId);
  }

  @Get('draw-logs')
  logs() {
    return this.ops.logs();
  }

  @Get('draw-logs/:id')
  logDetail(@Param('id', ParseIntPipe) id: number) {
    return this.ops.logDetail(id);
  }

  @Get('stats')
  stats(@Query('month') month?: string) {
    return this.ops.stats(month);
  }

  @Get('usage-history')
  usage(@Query('from') from?: string, @Query('to') to?: string, @Query('facilityId') facilityId?: string, @Query('orgName') orgName?: string) {
    return this.ops.usageHistory(from, to, facilityId ? Number(facilityId) : undefined, orgName);
  }

  @Get('dashboard')
  dashboard() {
    return this.ops.dashboard();
  }
}
