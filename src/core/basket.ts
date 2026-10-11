/**
 * 장바구니: 사용자가 고른 ETF를 따로 모아 두는 목록(순수 로직). 저장·화면은 src/web/basket.tsx 가 맡는다.
 *
 * 증권사 앱의 관심종목에 등록하거나 매매할 때 참고하는 용도라서, 코드(국내 6자리·해외 티커)와 이름을 항상 함께 들고 있고
 * 메모를 붙일 수 있다. 목록에 담긴 ETF가 나중에 데이터에서 사라져도(상장폐지·수집 기준 밖) 이름이 남아 있어 알아볼 수 있게
 * 담을 때의 이름을 같이 저장한다. 서버가 없는 정적 앱이므로 목록은 이 기기·브라우저에만 저장되고,
 * 다른 기기로 옮길 수 있게 코드 목록 가져오기와 링크(#/basket?codes=…)를 지원한다.
 */

export const BASKET_MAX = 100;
export const NOTE_MAX = 200;

export interface BasketItem {
  /** 스냅샷의 ETF 코드(국내 6자리, 해외 티커) */
  code: string;
  /** 담을 때의 이름(데이터에서 사라져도 알아볼 수 있게) */
  name: string;
  /** 담은 날 YYYY-MM-DD(기기의 현지 날짜). 알 수 없으면 "" */
  addedAt: string;
  /** 사용자 메모. 없으면 "" */
  note: string;
}

/** 코드로 받아들이는 모양: 영숫자와 . - (BRK.B 같은 티커 포함), 최대 12자 */
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9.-]{0,11}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const normalizeCode = (s: string): string => s.trim().toUpperCase();

/** 저장된 값(미지의 JSON)을 안전한 목록으로. 손상된 항목은 버리고, 중복 코드는 앞의 것만, 최대 BASKET_MAX 개 */
export function sanitizeItems(raw: unknown): BasketItem[] {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items : [];
  const out: BasketItem[] = [];
  const seen = new Set<string>();
  for (const r of list) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.code !== "string" || !CODE_RE.test(o.code.trim())) continue;
    const code = normalizeCode(o.code);
    if (seen.has(code)) continue;
    seen.add(code);
    const name = typeof o.name === "string" && o.name.trim() ? o.name.trim().slice(0, 120) : code;
    const addedAt = typeof o.addedAt === "string" && DATE_RE.test(o.addedAt) ? o.addedAt : "";
    const note = typeof o.note === "string" ? o.note.slice(0, NOTE_MAX) : "";
    out.push({ code, name, addedAt, note });
    if (out.length >= BASKET_MAX) break;
  }
  return out;
}

export const hasItem = (items: readonly BasketItem[], code: string): boolean => items.some((i) => i.code === normalizeCode(code));

export interface AddResult {
  items: BasketItem[];
  /** 새로 담긴 개수 */
  added: number;
  /** 이미 담겨 있어 건너뛴 개수 */
  existing: number;
  /** 가득 차서 못 담은 개수 */
  full: number;
}

/** ETF를 담는다(이미 있으면 그대로). 가득 차면 새 항목은 못 담는다. today 는 YYYY-MM-DD */
export function addItems(items: readonly BasketItem[], etfs: ReadonlyArray<{ code: string; name: string }>, today: string): AddResult {
  const next = [...items];
  const seen = new Set(next.map((i) => i.code));
  let added = 0;
  let existing = 0;
  let full = 0;
  for (const e of etfs) {
    const code = normalizeCode(e.code);
    if (seen.has(code)) {
      existing++;
      continue;
    }
    if (next.length >= BASKET_MAX) {
      full++;
      continue;
    }
    seen.add(code);
    next.push({ code, name: e.name.trim().slice(0, 120) || code, addedAt: DATE_RE.test(today) ? today : "", note: "" });
    added++;
  }
  return { items: added ? next : [...items], added, existing, full };
}

export const removeItem = (items: readonly BasketItem[], code: string): BasketItem[] => items.filter((i) => i.code !== normalizeCode(code));

/** 메모를 바꾼다(앞뒤 공백 정리, NOTE_MAX 자로 자름). 없는 코드면 그대로 */
export function setNote(items: readonly BasketItem[], code: string, note: string): BasketItem[] {
  const c = normalizeCode(code);
  const n = note.trim().slice(0, NOTE_MAX);
  return items.map((i) => (i.code === c ? { ...i, note: n } : i));
}

// ───────── 가져오기(붙여넣은 텍스트·링크의 코드 목록) ─────────

/**
 * 붙여넣은 텍스트에서 코드 후보를 뽑는다.
 * - 이 앱이 내보낸 요약 글: "이름 (코드)" 줄에서는 이름 뒤 마지막 괄호의 코드만 쓰고(이름 속 "(H)" 같은 괄호나 단어가 우연히 티커와 같아
 *   오인되는 것을 막기 위해), "↳" 로 시작하는 상세·메모 줄과 [제목]·※ 안내 줄은 건너뛴다.
 * - 이 앱이 내보낸 CSV(첫 줄이 code·ticker·코드·티커 로 시작하는 헤더): 헤더를 건너뛰고 줄마다 첫 칸만 코드로 본다.
 * - 그 밖에는 공백·쉼표·세미콜론·탭으로 나눈 각 조각을 코드로 본다(코드만 나열한 목록). 스프레드시트에서 복사한 "코드<탭>이름<탭>…" 행은 첫 칸만.
 * 코드로 볼 수 없는 조각은 버리고, 중복은 한 번만, 최대 BASKET_MAX*2 개에서 멈춘다.
 */
export function parseCodeText(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const strip = (c: string) => c.replace(/^["'$]+|["']+$/g, "").trim();
  const push = (raw: string) => {
    const t = strip(raw);
    if (!CODE_RE.test(t)) return;
    const c = normalizeCode(t);
    if (seen.has(c)) return;
    seen.add(c);
    out.push(c);
  };
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const csvMode = lines.length > 0 && /^(code|ticker|코드|티커)\s*[,;\t]/i.test(lines[0]!);
  for (const l of lines) {
    if (/^[#[※*↳]/.test(l)) continue; // 주석, [제목], ※ 안내, "↳" 상세·메모 줄
    if (csvMode) {
      if (!/^(code|ticker|코드|티커)\s*[,;\t]/i.test(l)) push(l.split(/[,;\t]/)[0]!);
    } else {
      const cells = l.split(/[,;\t]/).map((c) => c.trim());
      if (l.includes("\t") && cells.length >= 2 && CODE_RE.test(strip(cells[0]!)) && !cells.every((c) => CODE_RE.test(strip(c)))) {
        push(cells[0]!); // 스프레드시트 행("코드<탭>이름<탭>…"): 첫 칸이 코드(이름 속 괄호는 보지 않는다)
      } else {
        const paren = [...l.matchAll(/\(([A-Za-z0-9][A-Za-z0-9.-]{0,11})\)/g)];
        if (paren.length) push(paren[paren.length - 1]![1]!); // "이름 (코드)": 이름 뒤 마지막 괄호가 코드
        else for (const tok of l.split(/[\s,;|]+/)) push(tok); // 코드만 나열한 줄
      }
    }
    if (out.length >= BASKET_MAX * 2) break;
  }
  return out;
}

export interface Resolved<T> {
  found: T[];
  unknown: string[];
}

/** 코드 후보를 스냅샷의 ETF로 풀어낸다. lookup 이 못 찾은 것은 unknown(입력한 그대로 대문자) */
export function resolveCodes<T extends { code: string }>(codes: readonly string[], lookup: (code: string) => T | undefined): Resolved<T> {
  const found: T[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const c of codes) {
    const e = lookup(c) ?? lookup(normalizeCode(c));
    if (!e) {
      unknown.push(normalizeCode(c));
      continue;
    }
    if (seen.has(e.code)) continue;
    seen.add(e.code);
    found.push(e);
  }
  return { found, unknown };
}

// ───────── 링크 ─────────

/** #/basket?codes=A,B 의 codes 값을 코드 목록으로 */
export function codesFromQuery(value: string | null): string[] {
  if (!value) return [];
  return parseCodeText(value.replace(/,/g, "\n"));
}

/** 다른 기기로 옮기는 링크의 해시 부분 */
export const basketHash = (codes: readonly string[]): string => `#/basket?codes=${codes.map(encodeURIComponent).join(",")}`;
