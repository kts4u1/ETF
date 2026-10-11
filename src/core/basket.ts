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

/** 국내 ETF 코드 모양: 6자 영숫자(대문자)에 숫자가 하나 이상(0219E0, 069500 …). "(H)" 같은 이름 속 괄호나 영어 단어와 구별하는 데 쓴다 */
const KR_LIKE = /^(?=[0-9A-Z]*\d)[0-9A-Z]{6}$/;
/** 증권사 글에 자주 나오는 대문자 일반어(티커가 아님): 이름이 섞인 줄에서 티커 후보로 보지 않는다 */
const NOT_TICKER = new Set(["ETF", "ETN", "ETFS", "ETP", "KRW", "NAV", "NYSE", "NASDAQ", "US", "THE", "AND", "FOR"]);
/** 코드로 받아들일 수 있는 조각인가: 코드 모양이고, 숫자·점·하이픈뿐이면(가격·수량) 정확히 6자리 숫자일 때만 */
const validCode = (t: string): boolean => CODE_RE.test(t) && (!/^[0-9.-]+$/.test(t) || /^\d{6}$/.test(t));
/** 후보 상한: 장바구니(BASKET_MAX)보다 넉넉히 훑어서, 이름 속 단어가 후보 자리를 차지해도 뒤쪽 코드가 잘리지 않게 한다 */
const PARSE_MAX = BASKET_MAX * 20;

/**
 * 붙여넣은 텍스트에서 코드 후보를 뽑는다. 이 앱의 내보내기 글·CSV 와 증권사 관심종목 복사 글을 모두 읽으려고 줄마다 이렇게 본다.
 * 0) "[제목]"·"#"·"※"·"*"·"†"·"↳"(상세·메모) 줄은 건너뛴다.
 * 1) CSV(첫 줄이 code·ticker·코드·티커 헤더): 헤더를 건너뛰고 줄마다 첫 칸만(엑셀의 ="069500" 표기도 벗긴다).
 * 2) 탭으로 나뉜 행(스프레드시트): 첫 칸이 코드이고 다른 칸이 코드가 아니면 첫 칸만.
 * 3) 줄의 조각이 모두 코드 모양이면(코드만 나열한 줄) 전부.
 * 4) 그 밖에 이름이 섞인 줄: 국내 코드 모양(6자, 숫자 포함) 조각이 있으면 그것만, 없으면 이름 뒤 마지막 괄호의 2자 이상 코드("… (SPY)"),
 *    그것도 없으면 원문이 대문자·숫자인 조각만(Bond·Year 같은 일반 단어가 우연히 티커와 같아 오인되는 것을 막는다).
 * 숫자만 있는 조각은 6자리일 때만 코드로 본다(가격·거래량 제외). 중복은 한 번만, 후보는 PARSE_MAX 개에서 멈춘다.
 * 그래도 이름 속 단어가 티커와 겹칠 수 있어, 화면은 담기 전에 미리보기로 확인을 받는다.
 */
export function parseCodeText(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const strip = (c: string) => c.replace(/^=?["'$]+|["']+$/g, "").trim();
  const push = (raw: string) => {
    const t = strip(raw);
    if (!validCode(t)) return;
    const c = normalizeCode(t);
    if (seen.has(c)) return;
    seen.add(c);
    out.push(c);
  };
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/).map((l) => l.trim()).filter(Boolean);
  const headerRe = /^(code|ticker|코드|티커)\s*[,;\t]/i;
  const csvMode = lines.length > 0 && headerRe.test(lines[0]!);
  for (const l of lines) {
    if (/^[#[※*†↳]/.test(l)) continue;
    if (csvMode) {
      if (!headerRe.test(l)) push(l.split(/[,;\t]/)[0]!);
    } else {
      const body = l.replace(/^\d+[.)]\s+/, ""); // "1. 이름 (코드)" 같은 번호 목록의 번호
      const cells = body.split(/[,;\t]/).map((c) => c.trim());
      const tokens = body.split(/[\s,;|()]+/).map(strip).filter(Boolean);
      if (body.includes("\t") && cells.length >= 2 && CODE_RE.test(strip(cells[0]!)) && !cells.every((c) => CODE_RE.test(strip(c)))) {
        push(cells[0]!);
      } else if (tokens.length > 0 && !body.includes("(") && tokens.every(validCode)) {
        for (const t of tokens) push(t); // 코드만 나열한 줄
      } else {
        const kr = tokens.filter((t) => KR_LIKE.test(t.toUpperCase()));
        const paren = [...body.matchAll(/\(([A-Za-z0-9][A-Za-z0-9.-]{1,11})\)/g)];
        if (kr.length) for (const t of kr) push(t);
        else if (paren.length) push(paren[paren.length - 1]![1]!);
        else for (const t of tokens) if (/^[A-Z0-9][A-Z0-9.-]*$/.test(t) && !NOT_TICKER.has(t)) push(t);
      }
    }
    if (out.length >= PARSE_MAX) break;
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
