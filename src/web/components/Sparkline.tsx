interface Props {
  values: (number | null)[];
  width?: number;
  height?: number;
  label: string;
}

/** 카드용 미니 추세선. 값 범위에 맞춰 정규화하며 색은 중립(시리즈 1). 숫자 정보는 카드 본문에 있다. */
export function Sparkline({ values, width = 120, height = 36, label }: Props) {
  const pts = values.filter((v): v is number => v !== null);
  if (pts.length < 2) return <div className="spark-empty" style={{ width, height }} aria-label="차트 데이터 없음" />;
  const lo = Math.min(...pts);
  const hi = Math.max(...pts);
  const span = hi - lo || 1;
  const pad = 3;
  const d = values
    .map((v, i) => (v === null ? null : [pad + (i / (values.length - 1)) * (width - 2 * pad), pad + (1 - (v - lo) / span) * (height - 2 * pad)] as const))
    .filter((p): p is readonly [number, number] => p !== null)
    .map(([px, py], i) => `${i ? "L" : "M"}${px.toFixed(1)},${py.toFixed(1)}`)
    .join("");
  return (
    <svg width={width} height={height} role="img" aria-label={label} className="spark">
      <path d={d} fill="none" stroke="var(--series-1)" strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
