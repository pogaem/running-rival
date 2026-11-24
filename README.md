# 러닝 라이벌

비슷한 실력의 과거 기록 중 **경기 중 역전이 일어날 것으로 예측되는 상대**를 골라 대결하고, 추월 순간을 스포츠 중계처럼 음성·자막으로 전해 주는 모바일 웹 러닝 앱입니다.

- 배포 주소: https://running-rival.vercel.app

## 주요 기능
- **역전 예측 매칭:** 내 페이스와 거리에 맞춰, 역전이 예상되는 상대(가상 러너·내 기록·다른 러너 기록)를 고릅니다.
- **경기 흐름 분석 엔진:** GPS 거리로 두 러너의 격차, 추월, 접전, 예상 승률, 추월 예상 시간을 실시간 계산합니다.
- **중계:** 음성(TTS)과 자막, 심장 박동·함성 효과음. 중계 양(최소·일반·적극)을 고를 수 있습니다.
- **결과·전적:** 결승 후 결과 화면, 상세 분석(격차 그래프), 이 기기에 저장되는 전적과 최고 기록, 내 기록 공유.
- **데모 모드:** 위치 없이 가상 GPS로 체험할 수 있습니다.

## 문서
- [PRD.md](PRD.md) — 기획
- [DESIGN.md](DESIGN.md) — 설계
- [PLAN.md](PLAN.md) — 개발 계획과 작업 순서
- [CHECK.md](CHECK.md) — 공개 전 점검 결과

## 기술 스택
Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS · Supabase(공유 기록 저장) · Vercel

## 실행
```bash
npm install
npm run dev     # http://localhost:3000
npm test        # 테스트
npm run build   # 배포용 빌드
```
공유 기록 저장에는 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` 환경 변수가 필요합니다(없으면 개발 환경에서는 파일에 저장).

## 개인정보
서버에는 완주 거리, 고도 합계, 250m 단위 (시간, 거리) 점만 저장합니다. GPS 좌표·날짜·기기 정보는 올리지 않습니다.

## 출처
효과음 출처는 [public/sfx/CREDITS.md](public/sfx/CREDITS.md)를 참고하세요.
