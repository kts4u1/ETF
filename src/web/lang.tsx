import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { LANGS, LANG_NAME, parseLang, setLang as setCoreLang, tr, type Lang } from "../core/i18n";
import { readText, writeText } from "./storage";

const LANG_KEY = "etf-picker:lang";

interface LangCtx {
  lang: Lang;
  setLang: (lang: Lang) => void;
}
const Ctx = createContext<LangCtx>({ lang: "ko", setLang: () => {} });

/** 저장된 언어를 읽는다(없거나 손상되면 한국어). 첫 렌더 전에 core 의 현재 언어도 맞춘다. */
function initialLang(): Lang {
  const lang = parseLang(readText(LANG_KEY)) ?? "ko";
  setCoreLang(lang);
  document.documentElement.lang = lang;
  return lang;
}

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setState] = useState<Lang>(initialLang);
  const setLang = useCallback((next: Lang) => {
    // core 의 현재 언어를 먼저 바꿔야 이어지는 렌더에서 문장이 새 언어로 만들어진다
    setCoreLang(next);
    document.documentElement.lang = next;
    writeText(LANG_KEY, next);
    setState(next);
  }, []);
  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const useLang = (): LangCtx => useContext(Ctx);

/** 헤더의 언어 선택(한국어 / English). 각 언어는 그 언어의 이름으로 적는다. */
export function LangSwitch() {
  const { lang, setLang } = useLang();
  return (
    <div className="lang-switch" role="group" aria-label={tr("언어 선택", "Language")}>
      {LANGS.map((l) => (
        <button key={l} type="button" lang={l} aria-pressed={lang === l} onClick={() => setLang(l)}>
          {LANG_NAME[l]}
        </button>
      ))}
    </div>
  );
}
