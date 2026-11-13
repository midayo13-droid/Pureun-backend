import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { PublicService } from './public.service.js';
import { QaService } from './qa.service.js';

@Controller()
export class PublicController {
  constructor(private s: PublicService, private qa: QaService) {}

  @Get('intake/current') intake() { return this.s.intakeCurrent(); }
  @Get('facilities') facilities() { return this.s.listFacilities(); }
  @Get('calendar') calendar(@Query('facilityId') f: string, @Query('month') m: string) { return this.s.calendar(f, m); }
  @Post('refund/estimate') @HttpCode(200) refund(@Body() b: any) { return this.s.refundEstimate(b); }
  @Post('qa') @HttpCode(200) ask(@Body() b: any) { return this.qa.ask(b); }
}
