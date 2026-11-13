export function isResidentOrg(memberCount: number, residentCount: number): boolean {
  return memberCount > 0 && residentCount / memberCount >= 0.5;
}

export interface RateLike { facilityId: number; residentType: string; dayType: string; pricePerHour: number; }

export function rateFor(rates: RateLike[], facilityId: number, resident: boolean, weekendOrHoliday: boolean): number {
  const r = rates.find(
    (x) =>
      x.facilityId === facilityId &&
      x.residentType === (resident ? '구민' : '비구민') &&
      x.dayType === (weekendOrHoliday ? '주말·공휴일' : '평일'),
  );
  return r ? r.pricePerHour : 0;
}

/** 슬롯 1개(1시간) 금액. 감면액은 슬롯별 반올림 */
export function calcSlot(pricePerHour: number, discountRate: number, hours = 1) {
  const gross = pricePerHour * hours;
  const discount = Math.round(gross * discountRate);
  return { gross, discount, net: gross - discount };
}
