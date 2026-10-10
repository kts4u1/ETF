import type { SeriesFile } from "../core/types";

export const RANGES = { "1Y": 52, "3Y": 156, "5Y": 260 } as const;
export type RangeKey = keyof typeof RANGES;

/** 격자 끝에서 weeks 개를 잘라낸 날짜와, 해당 ETF의 값(상장 전은 null). */
export function sliceSeries(sf: SeriesFile, code: string, weeks: number) {
  const s = sf.s[code];
  if (!s) return null;
  const start = Math.max(0, sf.grid.length - weeks);
  const dates = sf.grid.slice(start);
  const values: (number | null)[] = dates.map((_, i) => {
    const g = start + i - s.o;
    return g >= 0 && g < s.c.length ? (s.c[g] as number) : null;
  });
  return { dates, values };
}

/**
 * 여러 ETF를 같은 시작점=100 으로 맞춘다(정규화). 모든 ETF가 데이터를 가진 가장 이른 시점을 시작점으로 삼는다.
 * 서로 다른 가격 단위(원)를 한 축에서 비교하려면 이렇게 지수화해야 한다.
 */
export function indexedSeries(sf: SeriesFile, codes: string[], weeks: number) {
  const slices = codes.map((c) => ({ code: c, s: sliceSeries(sf, c, weeks) })).filter((x) => x.s !== null);
  if (!slices.length) return null;
  const first = slices[0]!.s!;
  let start = 0;
  for (const { s } of slices) {
    const i = s!.values.findIndex((v) => v !== null);
    if (i > start) start = i;
  }
  const dates = first.dates.slice(start);
  const rows = slices.map(({ code, s }) => {
    const vals = s!.values.slice(start);
    const base = vals.find((v) => v !== null) ?? null;
    return { code, values: vals.map((v) => (v === null || base === null ? null : (v / base) * 100)) };
  });
  return { dates, rows, startDate: dates[0] ?? "" };
}

/** 한 ETF의 주간 종가를 공통 격자 전체 길이로(상장 전은 null) */
export function fullValues(sf: SeriesFile, code: string): (number | null)[] {
  const s = sf.s[code];
  if (!s) return sf.grid.map(() => null);
  return sf.grid.map((_, g) => (g - s.o >= 0 && g - s.o < s.c.length ? (s.c[g - s.o] as number) : null));
}
