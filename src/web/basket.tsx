import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BASKET_MAX, addItems, hasItem, removeItem, sanitizeItems, setNote, type AddResult, type BasketItem } from "../core/basket";
import { fmtNum, tr } from "../core/i18n";
import { readText, writeJson, writeText } from "./storage";
import { href } from "./router";

/** 앱 이름이 바뀌어도 저장된 설정과 같은 접두사를 유지한다(다른 키: etf-picker:prefs:v1, :lang, :theme) */
export const BASKET_KEY = "etf-picker:basket:v1";
const CORRUPT_KEY = `${BASKET_KEY}:corrupt`;

interface BasketCtx {
  items: BasketItem[];
  count: number;
  full: boolean;
  /** 마지막 저장이 실패했다(차단·시크릿 모드·용량 초과). 새로고침하면 목록이 사라지므로 화면이 알려야 한다 */
  saveFailed: boolean;
  has: (code: string) => boolean;
  /** 담기(이미 있으면 그대로). 결과로 몇 개가 담겼는지 돌려준다 */
  add: (etfs: ReadonlyArray<{ code: string; name: string }>) => AddResult;
  remove: (code: string) => void;
  /** 담겨 있으면 빼고 없으면 담는다. 가득 차서 못 담았으면 false */
  toggle: (etf: { code: string; name: string }) => boolean;
  setNote: (code: string, note: string) => void;
  clear: () => void;
}

const Ctx = createContext<BasketCtx | null>(null);

/** 기기의 현지 날짜 YYYY-MM-DD(UTC 가 아니라 사용자가 보는 날짜) */
export function localToday(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 저장된 목록을 읽는다. JSON 이 깨졌으면 원문을 한 번 백업해 두고(다음 저장이 덮어쓰기 전에) 빈 목록으로 시작한다 */
function load(): BasketItem[] {
  const raw = readText(BASKET_KEY);
  if (!raw) return [];
  try {
    return sanitizeItems(JSON.parse(raw));
  } catch {
    writeText(CORRUPT_KEY, raw);
    return [];
  }
}

const TOAST_MS = 4000;

export function BasketProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<BasketItem[]>(load);
  const [saveFailed, setSaveFailed] = useState(false);
  const [toast, setToast] = useState<{ id: number; text: string; link: boolean } | null>(null);
  // 같은 순간에 여러 번 부르는 경우(예: 여러 개 담기 직후 메모 저장)에도 최신 값 위에서 계산하도록 ref 로 들고 있는다
  const ref = useRef(items);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toastId = useRef(0);

  const say = useCallback((text: string, link = true) => {
    toastId.current += 1;
    setToast({ id: toastId.current, text, link });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), TOAST_MS);
  }, []);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  /** 저장까지 성공했는지 돌려준다(알림에 "저장되지 않아요"를 덧붙이려고) */
  const commit = useCallback((next: BasketItem[]): boolean => {
    ref.current = next;
    setItems(next);
    const ok = writeJson(BASKET_KEY, next);
    setSaveFailed(!ok);
    return ok;
  }, []);
  const unsaved = () => tr(" — 이 브라우저에서는 저장되지 않아요(새로고침하면 사라져요)", " — not saved in this browser (it disappears on refresh)");

  // 다른 탭에서 바뀌면 따라간다(저장소를 비우면 key 가 null)
  useEffect(() => {
    const on = (e: StorageEvent) => {
      if (e.key !== BASKET_KEY && e.key !== null) return;
      const next = load();
      ref.current = next;
      setItems(next);
    };
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  }, []);

  const value = useMemo<BasketCtx>(
    () => ({
      items,
      count: items.length,
      full: items.length >= BASKET_MAX,
      saveFailed,
      has: (code) => hasItem(items, code),
      add: (etfs) => {
        const r = addItems(ref.current, etfs, localToday());
        if (r.added > 0) {
          const ok = commit(r.items);
          say(tr(`${r.added}개를 장바구니에 담았어요(모두 ${fmtNum(r.items.length)}개)`, `Added ${r.added} to the basket (${fmtNum(r.items.length)} in total)`) + (ok ? "" : unsaved()));
        } else if (r.full > 0) say(tr(`장바구니가 가득 찼어요(최대 ${BASKET_MAX}개)`, `The basket is full (max ${BASKET_MAX})`), false);
        else say(tr("이미 장바구니에 모두 담겨 있어요", "All of them are already in the basket"), false);
        return r;
      },
      remove: (code) => {
        const gone = ref.current.find((i) => i.code === code.trim().toUpperCase());
        const next = removeItem(ref.current, code);
        const ok = commit(next);
        if (gone) say(tr(`${gone.name}을(를) 장바구니에서 뺐어요(${next.length}개 남음)`, `Removed ${gone.name} from the basket (${next.length} left)`) + (ok ? "" : unsaved()), false);
      },
      toggle: (etf) => {
        if (hasItem(ref.current, etf.code)) {
          const next = removeItem(ref.current, etf.code);
          const ok = commit(next);
          say(tr(`${etf.name}을(를) 장바구니에서 뺐어요(${next.length}개 남음)`, `Removed ${etf.name} from the basket (${next.length} left)`) + (ok ? "" : unsaved()), false);
          return true;
        }
        const r = addItems(ref.current, [etf], localToday());
        if (r.added === 0) {
          say(tr(`장바구니가 가득 찼어요(최대 ${BASKET_MAX}개). 빼고 담아 주세요`, `The basket is full (max ${BASKET_MAX}). Remove one to add another`), true);
          return false;
        }
        const ok = commit(r.items);
        say(tr(`${etf.name}을(를) 장바구니에 담았어요(${r.items.length}개)`, `Added ${etf.name} to the basket (${r.items.length})`) + (ok ? "" : unsaved()));
        return true;
      },
      setNote: (code, note) => commit(setNote(ref.current, code, note)),
      clear: () => {
        commit([]);
        say(tr("장바구니를 비웠어요", "Basket cleared"), false);
      },
    }),
    [items, saveFailed, commit, say],
  );
  return (
    <Ctx.Provider value={value}>
      {children}
      {/* 담기·빼기 결과를 보이고(눈) 읽어 주는(스크린리더) 알림. 항상 존재해야 변화가 읽힌다 */}
      <div className="toast-region" role="status" aria-live="polite">
        {toast && (
          <div className="toast" key={toast.id}>
            <span>{toast.text}</span>
            {toast.link && <a href={href("/basket")} onClick={() => setToast(null)}>{tr("장바구니 보기", "View basket")}</a>}
          </div>
        )}
      </div>
    </Ctx.Provider>
  );
}

export function useBasket(): BasketCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("BasketProvider 밖에서 useBasket 을 호출했습니다.");
  return v;
}
