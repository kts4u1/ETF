import { useEffect, useState } from "react";
import { fmtAsOf } from "../core/format";
import { langArray, tr } from "../core/i18n";
import { codesFromQuery } from "../core/basket";
import { BasketProvider, useBasket } from "./basket";
import { DataProvider, useApp } from "./data";
import { Combo } from "./pages/Combo";
import { Basket } from "./pages/Basket";
import { Compare } from "./pages/Compare";
import { Detail } from "./pages/Detail";
import { Explore } from "./pages/Explore";
import { Home } from "./pages/Home";
import { Learn } from "./pages/Learn";
import { Method } from "./pages/Method";
import { LangProvider, LangSwitch, useLang } from "./lang";
import { href, useRoute } from "./router";
import { readText, writeText } from "./storage";

const NAV_LABEL = langArray(
  ["추천", "탐색", "비교", "조합", "장바구니", "배우기", "방법론"],
  ["Picks", "Explore", "Compare", "Combos", "Basket", "Learn", "Method"],
);
const NAV = [
  { name: "home", path: "/" },
  { name: "explore", path: "/explore" },
  { name: "compare", path: "/compare" },
  { name: "combo", path: "/combo" },
  { name: "basket", path: "/basket" },
  { name: "learn", path: "/learn" },
  { name: "method", path: "/method" },
] as const;

/** 수집 출처 문장은 데이터에 한국어로 들어 있어, 영어 화면에서는 고정 문구로 보여준다 */
const SOURCE_EN = "Naver Finance · Yahoo Finance (US prices, distributions, FX, fund info) · Nasdaq ETF list";
const META_DESC_EN = "Understand and compare Korea-listed and US-listed ETFs in one list, and shortlist candidates with scores based on past data";

type Theme = "auto" | "light" | "dark";

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => (readText("etf-picker:theme") as Theme | null) ?? "auto");
  useEffect(() => {
    const el = document.documentElement;
    if (theme === "auto") el.removeAttribute("data-theme");
    else el.setAttribute("data-theme", theme);
    writeText("etf-picker:theme", theme === "auto" ? null : theme);
  }, [theme]);
  return [theme, () => setTheme((t) => (t === "auto" ? "dark" : t === "dark" ? "light" : "auto"))];
}

function Shell() {
  const route = useRoute();
  const { snap } = useApp();
  const basket = useBasket();
  const [theme, cycleTheme] = useTheme();

  let page;
  switch (route.name) {
    case "explore": page = <Explore />; break;
    case "etf": page = <Detail code={route.param} />; break;
    case "compare": page = <Compare codes={(route.query.get("codes") ?? "").split(",").filter(Boolean)} />; break;
    case "combo": page = <Combo />; break;
    case "basket": page = <Basket incoming={codesFromQuery(route.query.get("codes"))} />; break;
    case "learn": page = <Learn />; break;
    case "method": page = <Method />; break;
    default: page = <Home />;
  }

  const active = route.name === "etf" ? "explore" : route.name;
  return (
    <>
      <header className="topbar">
        <div className="wrap topbar-in">
          <a className="brand" href={href("/")}><span className="logo" aria-hidden>↗</span> ETF Search</a>
          <nav aria-label={tr("주 메뉴", "Main menu")}>
            {NAV.map((n, i) => (
              <a key={n.name} href={href(n.path)} aria-current={active === n.name ? "page" : undefined}>
                {NAV_LABEL[i]}
                {n.name === "basket" && basket.count > 0 && <span className="nav-count" aria-label={tr(`${basket.count}개 담김`, `${basket.count} in basket`)}>{basket.count}</span>}
              </a>
            ))}
          </nav>
          <LangSwitch />
          <button type="button" className="theme-btn" onClick={cycleTheme} title={tr("화면 테마 전환", "Switch theme")}
            aria-label={tr(
              `화면 테마: ${theme === "auto" ? "시스템" : theme === "dark" ? "다크" : "라이트"} (누르면 전환)`,
              `Theme: ${theme === "auto" ? "system" : theme === "dark" ? "dark" : "light"} (press to switch)`,
            )}>
            {theme === "auto" ? tr("◐ 자동", "◐ Auto") : theme === "dark" ? tr("☾ 다크", "☾ Dark") : tr("☀ 라이트", "☀ Light")}
          </button>
        </div>
      </header>
      <main className="wrap" id="main">{page}</main>
      <footer className="wrap footer">
        <p>{tr("데이터", "Data")}: {tr(snap.source, SOURCE_EN)} · {fmtAsOf(snap)} · {tr("수집", "Collected")} {snap.generatedAt.slice(0, 16).replace("T", " ")} UTC</p>
        <p>{tr("투자 판단의 책임은 투자자 본인에게 있습니다. 이 앱은 정보 제공용이며 투자자문이 아닙니다.", "Investment decisions are your own responsibility. This app is for information only and is not investment advice.")}</p>
      </footer>
    </>
  );
}

/** 언어가 바뀌면 화면 트리를 새로 만들어, 이전 언어로 계산해 둔 문장(useMemo 등)이 남지 않게 한다. 데이터는 DataProvider 에 그대로 있다. */
function Localized() {
  const { lang } = useLang();
  useEffect(() => {
    // 정적 meta 설명은 한국어라서 영어 화면에서만 영어 문구로 바꾼다
    const meta = document.querySelector('meta[name="description"]');
    if (!meta) return;
    if (!meta.hasAttribute("data-ko")) meta.setAttribute("data-ko", meta.getAttribute("content") ?? "");
    meta.setAttribute("content", lang === "en" ? META_DESC_EN : (meta.getAttribute("data-ko") ?? ""));
  }, [lang]);
  return <Shell key={lang} />;
}

export function App() {
  return (
    <LangProvider>
      <BasketProvider>
        <DataProvider>
          <Localized />
        </DataProvider>
      </BasketProvider>
    </LangProvider>
  );
}
