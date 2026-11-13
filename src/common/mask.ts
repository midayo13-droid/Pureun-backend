/** 이름 가림: 김수 → 김*, 김철수 → 김*수, 남궁민수 → 남**수 */
export function maskName(name: string | null | undefined): string {
  if (!name) return '';
  const n = [...name];
  if (n.length <= 1) return n[0];
  if (n.length === 2) return n[0] + '*';
  return n[0] + '*'.repeat(n.length - 2) + n[n.length - 1];
}

/** 휴대전화 가림: 01012345678 → 010-****-5678 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const d = phone.replace(/\D/g, '');
  if (d.length < 8) return '***';
  return `${d.slice(0, 3)}-****-${d.slice(-4)}`;
}
