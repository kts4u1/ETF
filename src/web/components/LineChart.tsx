import { useEffect, useMemo, useRef, useState } from "react";
import { isEn, tr } from "../../core/i18n";

export interface LineSeries {
  id: string;
  label: string;
  /** 우측 직접 라벨에 쓸 짧은 이름(없으면 label). 예: 같은 지수끼리 비교할 때 브랜드명만 */
  shortLabel?: string;
  /** CSS 색 (var(--series-1) 등) */
  color: string;
  /** 비교 대상 중 이 선이 주인공일 때(예: 조합) 더 굵게 */
  emphasis?: boolean;
  values: (number | null)[];
}

interface Props {
  dates: string[];
  series: LineSeries[];
  yFormat: (v: number) => string;
  ariaLabel: string;
  height?: number;
}

const M = { top: 10, bottom: 24, left: 54 };

/** 보기 좋은 눈금(1·2·5 × 10^n)을 약 count 개 뽑는다 */
export function niceTicks(min: number, max: number, count = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) return [min];
  const rough = (max - min) / count;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const f = rough / pow;
  const step = (f < 1.5 ? 1 : f < 3.5 ? 2 : f < 7.5 ? 5 : 10) * pow;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Math.round(v / step) * step);
  return out;
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T>, number] {
  const ref = useRef<T>(null);
  const [w, setW] = useState(640);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => entry && setW(Math.max(280, Math.floor(entry.contentRect.width))));
    ro.observe(el);
    setW(Math.max(280, Math.floor(el.getBoundingClientRect().width)));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const fmtDate = (d: string) => `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6, 8)}`;

const MONTH_EN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** x축 눈금: 데이터 길이에 맞춰 연/반기/분기 단위로 월이 바뀌는 지점에 라벨 */
function xTicks(dates: string[]): { i: number; label: string }[] {
  const n = dates.length;
  const step = n > 150 ? 12 : n > 70 ? 6 : 3;
  const out: { i: number; label: string }[] = [];
  let prev = "";
  dates.forEach((d, i) => {
    const ym = d.slice(0, 6);
    if (ym === prev) return;
    prev = ym;
    const month = Number(d.slice(4, 6));
    if ((month - 1) % step === 0 && i > 0) out.push({ i, label: month === 1 ? d.slice(0, 4) : isEn() ? MONTH_EN[month - 1]! : `${month}월` });
  });
  return out;
}

export function LineChart({ dates, series, yFormat, ariaLabel, height = 280 }: Props) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const multi = series.length > 1;
  const right = multi ? Math.min(150, Math.round(width * 0.24)) : 12;
  const innerW = width - M.left - right;
  const innerH = height - M.top - M.bottom;
  const n = dates.length;

  const { yMin, yMax, ticks } = useMemo(() => {
    let lo = Infinity;
    let hi = -Infinity;
    for (const s of series) for (const v of s.values) if (v !== null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    if (!Number.isFinite(lo)) return { yMin: 0, yMax: 1, ticks: [0, 1] };
    const pad = (hi - lo) * 0.06 || hi * 0.05 || 1;
    const t = niceTicks(lo - pad, hi + pad, 4);
    return { yMin: Math.min(lo - pad, t[0] ?? lo), yMax: Math.max(hi + pad, t[t.length - 1] ?? hi), ticks: t };
  }, [series]);

  const x = (i: number) => M.left + (n <= 1 ? 0 : (i / (n - 1)) * innerW);
  const y = (v: number) => M.top + (1 - (v - yMin) / (yMax - yMin || 1)) * innerH;

  const paths = series.map((s) => {
    let d = "";
    let pen = false;
    s.values.forEach((v, i) => {
      if (v === null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  });

  // 우측 직접 라벨(시리즈 2개 이상): 마지막 값 위치 기준, 겹치면 14px 간격으로 밀어낸다
  const endLabels = useMemo(() => {
    if (!multi) return [];
    const items = series
      .map((s, k) => {
        let last = -1;
        for (let i = s.values.length - 1; i >= 0; i--) if (s.values[i] !== null) { last = i; break; }
        return last < 0 ? null : { k, y: y(s.values[last] as number), label: s.shortLabel ?? s.label };
      })
      .filter((v): v is { k: number; y: number; label: string } => v !== null)
      .sort((a, b) => a.y - b.y);
    for (let i = 1; i < items.length; i++) {
      const prev = items[i - 1]!;
      if (items[i]!.y - prev.y < 14) items[i]!.y = prev.y + 14;
    }
    return items;
  }, [series, multi, yMin, yMax, height, width]);

  const pick = (clientX: number, rect: DOMRect) => {
    const px = clientX - rect.left - M.left;
    const i = Math.round((px / innerW) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") { setHover((h) => Math.max(0, (h ?? n) - 1)); e.preventDefault(); }
    else if (e.key === "ArrowRight") { setHover((h) => Math.min(n - 1, (h ?? -1) + 1)); e.preventDefault(); }
    else if (e.key === "Escape") setHover(null);
  };

  const tip = hover === null ? null : { cx: x(hover), rows: series.map((s) => ({ s, v: s.values[hover] ?? null })) };
  const tipLeft = tip ? (tip.cx > width * 0.6 ? tip.cx - 12 : tip.cx + 12) : 0;
  const flip = tip ? tip.cx > width * 0.6 : false;

  return (
    <div className="chart" ref={wrapRef}>
      {multi && (
        <ul className="legend" aria-label={tr("범례", "Legend")}>
          {series.map((s) => (
            <li key={s.id}>
              <span className="legend-key" style={{ background: s.color }} aria-hidden />
              {s.label}
            </li>
          ))}
        </ul>
      )}
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
        onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line className="grid" x1={M.left} x2={width - right} y1={y(t)} y2={y(t)} />
            <text className="axis" x={M.left - 8} y={y(t)} textAnchor="end" dominantBaseline="middle">{yFormat(t)}</text>
          </g>
        ))}
        {xTicks(dates).map((t) => (
          <text key={t.i} className="axis" x={x(t.i)} y={height - 6} textAnchor="middle">{t.label}</text>
        ))}
        {series.map((s, k) => (
          <path key={s.id} d={paths[k]} fill="none" stroke={s.color} strokeWidth={s.emphasis ? 3 : 2} strokeLinejoin="round" strokeLinecap="round" />
        ))}
        {endLabels.map((l) => (
          <text key={l.k} className="end-label" x={width - right + 8} y={l.y} dominantBaseline="middle">
            {l.label.length > 11 ? `${l.label.slice(0, 11)}…` : l.label}
          </text>
        ))}
        {tip && (
          <g pointerEvents="none">
            <line className="crosshair" x1={tip.cx} x2={tip.cx} y1={M.top} y2={height - M.bottom} />
            {tip.rows.map(({ s, v }) =>
              v === null ? null : <circle key={s.id} cx={tip.cx} cy={y(v)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />,
            )}
          </g>
        )}
      </svg>
      {tip && hover !== null && (
        <div className="tooltip" style={{ left: tipLeft, transform: flip ? "translateX(-100%)" : undefined }} role="status">
          <div className="tooltip-date">{fmtDate(dates[hover] as string)}</div>
          {tip.rows.map(({ s, v }) => (
            <div className="tooltip-row" key={s.id}>
              <span className="legend-key" style={{ background: s.color }} aria-hidden />
              <strong>{v === null ? "-" : yFormat(v)}</strong>
              <span className="tooltip-name">{s.label}</span>
            </div>
          ))}
        </div>
      )}
      <details className="chart-table">
        <summary>{tr("표로 보기", "View as table")}</summary>
        <table>
          <thead>
            <tr><th>{tr("날짜", "Date")}</th>{series.map((s) => <th key={s.id}>{s.label}</th>)}</tr>
          </thead>
          <tbody>
            {sampleIdx(n, 10).map((i) => (
              <tr key={i}>
                <td>{fmtDate(dates[i] as string)}</td>
                {series.map((s) => <td key={s.id}>{s.values[i] == null ? "-" : yFormat(s.values[i] as number)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

/** 0..n-1 에서 마지막 점을 포함해 count 개를 고르게 뽑는다 */
function sampleIdx(n: number, count: number): number[] {
  if (n <= count) return Array.from({ length: n }, (_, i) => i);
  const out = new Set<number>();
  for (let k = 0; k < count; k++) out.add(Math.round((k * (n - 1)) / (count - 1)));
  return [...out];
}
