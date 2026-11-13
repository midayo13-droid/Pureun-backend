import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QaLog, RegulationClause } from '../../entities.js';
import { AppError, fail } from '../../common/errors.js';

const SYN: Record<string, string[]> = {
  취소: ['환불', '취소'],
  환불: ['환불', '취소'],
  돈: ['요금', '환불'],
  비용: ['요금'],
  가격: ['요금'],
  얼마: ['요금'],
  예약: ['신청', '접수'],
  신청: ['신청', '접수'],
  할인: ['감면'],
  감면: ['감면'],
  추첨: ['추첨', '무작위'],
  휴관: ['이용 불가', '휴관'],
  정기: ['정기'],
  주말: ['주말', '공휴일'],
  증빙: ['증빙', '서류'],
  서류: ['증빙', '서류'],
  이기도: ['중복', '가장 높은'],
  동시: ['중복', '가장 높은'],
  겹치: ['중복', '가장 높은'],
  여러: ['중복', '가장 높은'],
  중복: ['중복', '가장 높은'],
  두개: ['중복', '가장 높은'],
};

const STOP = new Set([
  '센터', '센터에', '있나요', '있어요', '어떻게', '무엇', '인가요', '합니까', '하나요', '되나요', '가능', '가능한가요', '경우',
  '어디', '언제', '알려주세요', '알려', '주세요', '해주세요', '이면', '그리고', '그런데', '있는', '하는', '하면', '있습니까', '입니까',
]);

@Injectable()
export class QaService {
  constructor(
    @InjectRepository(RegulationClause) private clauses: Repository<RegulationClause>,
    @InjectRepository(QaLog) private logs: Repository<QaLog>,
    private config: ConfigService,
  ) {}

  /**
   * Dify 챗봇 호출. DIFY_API_KEY가 없거나 호출에 실패하면 null을 돌려주고,
   * 호출한 쪽은 조항 원문만 보여준다(MSG-19). 키는 서버에서만 쓴다.
   */
  async generateAnswer(question: string, clauses: RegulationClause[]): Promise<string | null> {
    const key = this.config.get<string>('DIFY_API_KEY');
    const base = (this.config.get<string>('DIFY_API_URL') ?? 'https://api.dify.ai/v1').replace(/\/$/, '');
    if (!key) return null;
    const clauseText = clauses
      .map((c) => `[${c.doc}|${c.articleLabel}|${c.title}|우선순위${c.priority}]\n${c.body}`)
      .join('\n\n')
      .slice(0, 8000);
    try {
      const res = await fetch(`${base}/chat-messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          inputs: { clauses: clauseText },
          query: question,
          response_mode: 'blocking',
          conversation_id: '',
          user: 'rental-web',
        }),
        signal: AbortSignal.timeout(45000),
      });
      if (!res.ok) return null;
      const data: any = await res.json();
      const text = typeof data?.answer === 'string' ? data.answer.trim() : '';
      return text || null;
    } catch {
      return null;
    }
  }

  private tokens(q: string): string[] {
    const raw = q.match(/[가-힣A-Za-z0-9]{2,}/g) ?? [];
    const out = new Set<string>();
    for (const t of raw) {
      out.add(t);
      for (let n = t.length - 1; n >= 2; n--) out.add(t.slice(0, n));
      for (const k of Object.keys(SYN)) if (t.includes(k)) SYN[k].forEach((s) => out.add(s));
    }
    return [...out].filter((t) => !STOP.has(t));
  }

  async ask(b: any) {
    const question = String(b?.question ?? '').trim();
    if (!question) throw new AppError(400, 'MSG-21', '질문을 입력해 주세요.');
    if (/01[016789][-\s]?\d{3,4}[-\s]?\d{4}/.test(question) || /\d{6}[-\s]?[1-8]\d{6}/.test(question)) fail(400, 'MSG-18');
    const toks = this.tokens(question);
    const all = await this.clauses.find();
    const scored = all
      .map((c) => {
        let score = 0;
        for (const t of toks) {
          if (c.title.includes(t)) score += 3 * Math.min(t.length, 4);
          if (c.body.includes(t)) score += Math.min(t.length, 4);
        }
        return { c, score };
      })
      .filter((x) => x.score >= 6)
      .sort((a, b2) => b2.score - a.score)
      .slice(0, 5)
      .sort((a, b2) => a.c.priority - b2.c.priority || b2.score - a.score)
      .map((x) => x.c);
    const answer = scored.length ? await this.generateAnswer(question, scored) : null;
    const answeredBy = answer ? 'AI' : scored.length ? '검색만' : '근거 없음';
    await this.logs.save(
      this.logs.create({ question: question.slice(0, 500), citedClauseIds: scored.map((c) => c.clauseId).join(','), answeredBy }),
    );
    return {
      answer,
      answeredBy,
      clauses: scored.map((c) => ({ clauseId: c.clauseId, doc: c.doc, articleLabel: c.articleLabel, title: c.title, body: c.body, priority: c.priority })),
    };
  }
}
