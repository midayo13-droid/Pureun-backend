# Pureun-backend

푸른구 국민체육센터 시설 대관 시스템의 **백엔드**(NestJS)입니다. 가상 고객 인터뷰를 바탕으로 만든 실습 프로젝트이며, 실제 기관과 관련이 없습니다.

> **무료 서버 안내**
> 이 서버는 Render 무료 플랜에 올리도록 준비되어 있습니다. 무료 서버는 **15분 정도 요청이 없으면 잠들고, 잠든 뒤 첫 접속에는 30초~1분쯤 걸릴 수 있습니다.** 처음에 화면이 비어 있거나 오류처럼 보이면 잠시 기다렸다가 새로 고침해 주세요. 한 번 깨어난 뒤에는 정상 속도로 동작합니다.

프런트엔드 저장소: [Pureun-frontend](https://github.com/midayo13-droid/Pureun-frontend) (확인용 계정은 그쪽 README에 있습니다)

## 하는 일
- 접수 기간, 같은 시설·시간 겹침, 이용 불가일, 정기 대관 주 2회, 개인정보 동의 같은 **규칙을 모두 서버에서 검사**합니다. 화면에서 보낸 값을 그대로 믿지 않습니다.
- 접수 마감 뒤 슬롯별 **무작위 추첨**(가산점 없음)을 실행하고, 과정을 기록합니다.
- 구민·비구민 요금, 감면(증빙 승인 후 적용, 가장 높은 하나만), 환불액을 계산합니다.
- 규정 질문에 근거 조항을 찾아 보여주고, Dify 챗봇이 연결되어 있으면 AI 답변을 덧붙입니다.
- 이름·휴대전화는 관리자 목록에서 가려서 내보내고, 상세 열람은 기록합니다. 비밀번호는 암호화해서 저장합니다.

## 기술 스택
| 구분 | 내용 |
|---|---|
| 프레임워크 | NestJS 12 (ESM), TypeScript |
| 데이터베이스 | PostgreSQL, TypeORM (테이블은 `rental` 스키마에만 만듭니다) |
| 로그인 | JWT, bcryptjs |
| 챗봇 | Dify 챗봇 API (선택) |
| 배포 | Render (무료 플랜) |

## 폴더
```
src/
  entities.ts        테이블 15개 정의
  common/            오류 메시지, 이름·전화 가림, 로그인·권한 검사, 요금 계산, 공휴일
  modules/core/      인증, 시설·달력, 신청, 증빙, 이용 불가일, 접수 일정, 규정 검색
  modules/ops/       추첨, 통계, 이용 이력, 대시보드
  seed/              가상 데이터 넣기
seed-data/           가상 데이터(JSON)와 변환 스크립트
docs/                기획서, 기능명세서, 메뉴구조도, 요구사항 정의서, 테스트 결과서, 인터뷰 기록
render.yaml          Render 배포 설정
```

## 환경 변수
`.env` 파일(저장소에 올라가지 않음)이나 Render의 Environment에 넣습니다. 값이 비어 있는 예시는 `.env.example`에 있습니다.

| 이름 | 뜻 | 필수 | 예시·기본값 |
|---|---|---|---|
| `DATABASE_URL` | PostgreSQL 접속 주소 | 필수 | `postgresql://사용자:비밀번호@호스트/DB이름` |
| `JWT_SECRET` | 로그인 토큰 서명 키. 길고 무작위인 문자열 | 필수 | Render에서는 자동 생성 가능 |
| `CORS_ORIGIN` | 접속을 허용할 프런트엔드 주소. 여러 개는 쉼표로 구분 | 필수 | `https://pureun-frontend.vercel.app` |
| `DB_SCHEMA` | 테이블을 만들 스키마 이름 | 선택 | `rental` |
| `PORT` | 서버 포트. Render가 자동으로 넣어 줍니다 | 선택 | `4000` |
| `DIFY_API_URL` | Dify API 주소 | 선택 | `https://api.dify.ai/v1` |
| `DIFY_API_KEY` | Dify 앱 API 키. 없으면 AI 답변 없이 조항 검색 결과만 보여줍니다 | 선택 | (비워 둠) |
| `GPT_API_KEY` | GPT API 키. 현재 코드에서는 사용하지 않습니다(예약) | 선택 | (비워 둠) |
| `GPT_MODEL` | GPT 모델 이름(예약) | 선택 | `gpt-4o-mini` |
| `UPLOAD_DIR` | 감면 증빙 파일을 저장할 폴더 | 선택 | `uploads` |
| `NODE_VERSION` | Render가 쓸 Node 버전 | 선택 | `24` |

## 내 컴퓨터에서 실행
```bash
npm install
cp .env.example .env     # 값을 채웁니다
npm run build
npm run seed             # 가상 데이터 넣기 (rental 스키마만 비우고 다시 채웁니다)
npm run start:dev        # http://localhost:4000/api
```
- `npm run seed`는 같은 데이터베이스를 쓰는 다른 스키마를 건드리지 않습니다. 접수 중인 기간은 **시드를 실행한 시각 기준**으로 만들어지므로(다음 달 이용분, 마감은 4일 뒤), 시연하려면 시드를 다시 실행하거나 관리자 화면에서 마감 시각을 수정하세요.

## Render에 올리기
1. Render에서 **New → Web Service**로 이 저장소를 연결합니다. (`render.yaml`이 있어 **Blueprint**로 만들 수도 있습니다.)
2. 아래처럼 설정합니다.

| 항목 | 값 |
|---|---|
| Runtime | Node |
| **Build Command** | `npm install --include=dev && npm run build` |
| **Start Command** | `npm run start:prod` |
| Health Check Path | `/api` |
| Instance Type | Free |
| Region | Virginia (US East) — 데이터베이스와 같은 지역으로 맞추면 응답이 빨라집니다 |

3. Environment에 위 표의 `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGIN`(Vercel 주소), 필요하면 `DIFY_API_KEY`를 넣습니다.
4. 배포가 끝나면 `https://<서비스이름>.onrender.com/api`가 열리는지 확인하고, 이 주소 뒤에 `/api`까지 붙인 값을 프런트엔드의 `NEXT_PUBLIC_API_URL`에 넣습니다.
5. 가상 데이터가 아직 없다면 내 컴퓨터에서 같은 `DATABASE_URL`로 `npm run seed`를 한 번 실행합니다. (Render 무료 플랜에는 Shell이 없습니다.)

### 무료 서버로 쓸 때 알아둘 점
- 잠들었다 깨어나는 첫 접속이 느립니다(위 안내).
- 무료 서버의 디스크는 재시작하면 사라집니다. 그래서 **업로드한 감면 증빙 파일은 오래 보관되지 않습니다.** 실제 운영에서는 별도 저장소(S3 등)가 필요합니다.
- 테이블은 서버가 시작할 때 자동으로 맞춥니다(`synchronize`). 시연용 설정이며, 실제 운영에서는 마이그레이션으로 바꿔야 합니다.
- Dify 답변은 10~20초 걸릴 수 있습니다.

## 문서
`docs/` 폴더에 있습니다.
- [기획서](docs/기획서.md), [기능명세서](docs/기능명세서.md)
- [요구사항 정의서 v2](docs/요구사항정의서_푸른구체육센터_v2.xlsx), [메뉴구조도](docs/메뉴구조도.xlsx), [테스트 결과서](docs/테스트결과서.xlsx)
- [인터뷰 기록](docs/18.%20공공%20체육시설%20대관%20푸른구%20국민체육센터%20인터뷰%20기록03.txt)
