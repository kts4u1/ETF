#!/usr/bin/env bash
# 데이터 자동 갱신: sync(호출 제한(429) 같은 일시 오류는 같은 날 캐시를 쓰며 재시도) → 테스트 → 빌드 → 변경 판정.
# 끝나면 마지막 줄에 REFRESH_RESULT=changed|unchanged|sync-failed 를 출력한다. 커밋·게시는 호출한 쪽(GitHub Actions 또는 루틴)이 한다.
set -euo pipefail
cd "$(dirname "$0")/.."
export NODE_USE_ENV_PROXY=1 # 프록시 환경에서 Node 의 fetch 가 프록시를 쓰게 한다(프록시가 없으면 영향 없음)

attempts="${REFRESH_ATTEMPTS:-3}"
ok=0
for i in $(seq 1 "$attempts"); do
  if npm run sync; then ok=1; break; fi
  echo "sync 실패(${i}/${attempts}) — 30초 뒤 다시 시도합니다(받은 것은 캐시에서 읽고 실패한 것만 다시 받습니다)"
  sleep 30
done
if [ "$ok" != 1 ]; then echo "REFRESH_RESULT=sync-failed"; exit 1; fi

npm test
npm run build
result="$(node scripts/data-changed.mjs | tee /dev/stderr | tail -n 1)"
echo "REFRESH_RESULT=${result}"
