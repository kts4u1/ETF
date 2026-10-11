#!/usr/bin/env bash
# 데이터 자동 갱신: 제공처 접속 점검 → sync(호출 제한(429) 같은 일시 오류는 같은 날 캐시를 쓰며 재시도) → 테스트 → 빌드 → 커밋 여부 판정.
# 끝나면 마지막 줄에 REFRESH_RESULT=<값> 을 출력한다.
#   changed       커밋할 변화가 있다(public/data 가 갱신된 상태로 남는다)
#   unchanged     커밋할 만한 변화가 없다(public/data 는 커밋된 상태로 되돌린다)
#   suspicious    종목이 갑자기 줄었거나 기준일이 과거로 가는 등 이상하다(되돌리고 종료 코드 1)
#   blocked       제공처 접속이 막혀 있다(종료 코드 1)
#   sync-failed   재시도해도 수집이 끝나지 않았다(종료 코드 1)
#   check-failed  테스트 또는 빌드가 실패했다(종료 코드 1)
# 커밋·게시는 호출한 쪽(GitHub Actions 또는 루틴)이 한다.
# 환경변수: REFRESH_ATTEMPTS(기본 3), REFRESH_RETRY_SLEEP(재시도 대기 기본 60초, 시도마다 배로), REFRESH_DEADLINE_MIN(이 시간을 넘으면 더 시도하지 않음, 기본 45),
#           REFRESH_SKIP_PROBE=1(접속 점검 건너뜀), REFRESH_STALE_DAYS(시세만 바뀐 경우 커밋 기준 일수, 기본 5 — scripts/data-changed.ts 참고)
set -euo pipefail
cd "$(dirname "$0")/.."
export NODE_USE_ENV_PROXY=1 # 프록시 환경에서 Node 의 fetch 가 프록시를 쓰게 한다(프록시가 없으면 영향 없음)

attempts="${REFRESH_ATTEMPTS:-3}"
retry_sleep="${REFRESH_RETRY_SLEEP:-60}"
deadline_min="${REFRESH_DEADLINE_MIN:-45}"
start="$(date +%s)"

# 전체 수집(약 9,500회 호출)을 시작하기 전에 제공처마다 가벼운 요청을 보내, 막혀 있으면 몇 분 안에 이유와 함께 끝낸다.
if [ "${REFRESH_SKIP_PROBE:-0}" != 1 ]; then
  if ! npx tsx scripts/probe-sources.ts; then
    echo "REFRESH_RESULT=blocked"
    exit 1
  fi
fi

ok=0
for i in $(seq 1 "$attempts"); do
  if npm run sync; then ok=1; break; fi
  if [ "$i" -ge "$attempts" ]; then break; fi
  elapsed_min=$(( ($(date +%s) - start) / 60 ))
  if [ "$elapsed_min" -ge "$deadline_min" ]; then
    echo "수집을 시작한 지 ${elapsed_min}분이 지나 더 시도하지 않습니다(제한 ${deadline_min}분)"
    break
  fi
  wait=$(( retry_sleep * i ))
  echo "sync 실패(${i}/${attempts}) — ${wait}초 뒤 다시 시도합니다(받은 것은 캐시에서 읽고 실패한 것만 다시 받습니다)"
  sleep "$wait"
done
if [ "$ok" != 1 ]; then echo "REFRESH_RESULT=sync-failed"; exit 1; fi

if ! npm test; then echo "REFRESH_RESULT=check-failed"; exit 1; fi
if ! npm run build; then echo "REFRESH_RESULT=check-failed"; exit 1; fi

# 판정 출력은 변수에 담아 stderr 로 보여 준다. (tee /dev/stderr 는 stderr 가 파일로 리다이렉트된 환경에서 그 파일을 비워 버린다)
decision="$(npx tsx scripts/data-changed.ts)"
printf '%s\n' "$decision" >&2
result="$(printf '%s\n' "$decision" | tail -n 1)"
echo "REFRESH_RESULT=${result}"
if [ "$result" = "suspicious" ]; then exit 1; fi
