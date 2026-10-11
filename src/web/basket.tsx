import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { BASKET_MAX, addItems, hasItem, removeItem, sanitizeItems, setNote, type AddResult, type BasketItem } from "../core/basket";
import { readJson, writeJson } from "./storage";

/** 앱 이름이 바뀌어도 저장된 설정과 같은 접두사를 유지한다(다른 키: etf-picker:prefs:v1, :lang, :theme) */
export const BASKET_KEY = "etf-picker:basket:v1";

interface BasketCtx {
  items: BasketItem[];
  count: number;
  full: boolean;
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

const load = (): BasketItem[] => sanitizeItems(readJson<unknown>(BASKET_KEY));

export function BasketProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<BasketItem[]>(load);
  // 같은 순간에 여러 번 부르는 경우(예: 여러 개 담기 직후 메모 저장)에도 최신 값 위에서 계산하도록 ref 로 들고 있는다
  const ref = useRef(items);
  const commit = useCallback((next: BasketItem[]) => {
    ref.current = next;
    setItems(next);
    writeJson(BASKET_KEY, next);
  }, []);

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
      has: (code) => hasItem(items, code),
      add: (etfs) => {
        const r = addItems(ref.current, etfs, localToday());
        if (r.added > 0) commit(r.items);
        return r;
      },
      remove: (code) => commit(removeItem(ref.current, code)),
      toggle: (etf) => {
        if (hasItem(ref.current, etf.code)) {
          commit(removeItem(ref.current, etf.code));
          return true;
        }
        const r = addItems(ref.current, [etf], localToday());
        if (r.added === 0) return false;
        commit(r.items);
        return true;
      },
      setNote: (code, note) => commit(setNote(ref.current, code, note)),
      clear: () => commit([]),
    }),
    [items, commit],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBasket(): BasketCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("BasketProvider 밖에서 useBasket 을 호출했습니다.");
  return v;
}
