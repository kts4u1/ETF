/** 백테스트 구간 해석 보조: 구간(CI)이 없는 칸(표본 2개 미만 → JSON null)을 유의하다고 세지 않는다. */

/** 겹치지 않는 표본의 95% 구간이 0을 벗어나는가(양의 방향). */
export function isSig(c: { indepMean: number; indepCI: number | null }): boolean {
  return c.indepCI !== null && Number.isFinite(c.indepCI) && c.indepMean - c.indepCI > 0;
}

/** 조합 칸의 낙폭 차이(양수 = 낙폭이 작음)가 유의한가. */
export function isSigDrop(c: { dMdd: number; dMddCI: number | null }): boolean {
  return c.dMddCI !== null && Number.isFinite(c.dMddCI) && c.dMdd - c.dMddCI > 0;
}

/** 조합 칸의 수익 차이(방향 무관)가 유의한가. */
export function isSigRet(c: { dRet: number; dRetCI: number | null }): boolean {
  return c.dRetCI !== null && Number.isFinite(c.dRetCI) && Math.abs(c.dRet) - c.dRetCI > 0;
}

/** 구간 반폭을 %p 로 표기. 없으면 '–'. */
export function fmtCI(ci: number | null): string {
  return ci === null || !Number.isFinite(ci) ? "–" : (ci * 100).toFixed(1);
}
