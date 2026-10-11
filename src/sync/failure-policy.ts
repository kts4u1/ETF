/**
 * 수집 실패 허용 기준. 무인 자동 갱신(GitHub Actions)은 사람이 결과를 보지 않고 커밋하므로,
 * "일부 종목이 조용히 빠진 스냅샷"이 만들어지지 않도록 단계마다 허용 실패 수를 정해 둔다.
 * 기준을 넘기면 파일을 쓰기 전에 오류로 끝나고, refresh-data.sh 가 같은 날 캐시를 쓰며 실패한 것만 다시 받는다.
 */

/** 허용 실패 수: 후보의 rate 비율과 최소 허용 건수(floor) 중 큰 쪽 */
export function failureLimit(total: number, rate: number, floor: number): number {
  return Math.max(floor, Math.floor(total * rate));
}

export interface FailureRule {
  /** 후보 대비 허용 비율(0~1) */
  rate: number;
  /** 후보가 적을 때도 이 건수까지는 허용 */
  floor: number;
}

/** 국내(네이버): 시세를 못 받은 ETF 는 목록에서 빠지고, 상세를 못 받으면 총보수·운용사가 비므로 따로 센다 */
export const DOMESTIC_PRICE_RULE: FailureRule = { rate: 0.003, floor: 2 };
export const DOMESTIC_DETAIL_RULE: FailureRule = { rate: 0.01, floor: 5 };
/** 해외(야후): 실패한 종목은 스냅샷과 검색 색인에서 모두 빠졌다가 다음 날 돌아오므로 낮게 둔다 */
export const US_STAGE_RULE: FailureRule = { rate: 0.003, floor: 2 };

export function assertWithinLimit(label: string, failures: number, total: number, rule: FailureRule): void {
  const limit = failureLimit(total, rule.rate, rule.floor);
  if (failures > limit) {
    throw new Error(
      `${label}: ${total}개 중 ${failures}개가 실패했습니다(허용 ${limit}개 이내). 일부가 조용히 빠진 스냅샷을 만들지 않으려고 중단합니다. ` +
        "같은 날 다시 실행하면 이미 받은 것은 캐시에서 읽고 실패한 것만 다시 받습니다.",
    );
  }
}
