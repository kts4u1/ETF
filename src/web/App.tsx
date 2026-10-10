import { useEffect, useState } from "react";
import { fmtAsOf } from "../core/format";
import { DataProvider, useApp } from "./data";
import { Combo } from "./pages/Combo";
import { Compare } from "./pages/Compare";
import { Detail } from "./pages/Detail";
import { Explore } from "./pages/Explore";
import { Home } from "./pages/Home";
import { Learn } from "./pages/Learn";
import { Method } from "./pages/Method";
import { href, useRoute } from "./router";
import { readText, writeText } from "./storage";

const NAV = [
  { name: "home", path: "/", label: "추천" },
  { name: "explore", path: "/explore", label: "탐색" },
  { name: "compare", path: "/compare", label: "비교" },
  { name: "combo", path: "/combo", label: "조합" },
  { name: "learn", path: "/learn", label: "배우기" },
  { name: "method", path: "/method", label: "방법론" },
] as const;

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
  const [theme, cycleTheme] = useTheme();

  let page;
  switch (route.name) {
    case "explore": page = <Explore />; break;
    case "etf": page = <Detail code={route.param} />; break;
    case "compare": page = <Compare codes={(route.query.get("codes") ?? "").split(",").filter(Boolean)} />; break;
    case "combo": page = <Combo />; break;
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
          <nav aria-label="주 메뉴">
            {NAV.map((n) => (
              <a key={n.name} href={href(n.path)} aria-current={active === n.name ? "page" : undefined}>{n.label}</a>
            ))}
          </nav>
          <button type="button" className="theme-btn" onClick={cycleTheme} title="화면 테마 전환" aria-label={`화면 테마: ${theme === "auto" ? "시스템" : theme === "dark" ? "다크" : "라이트"} (누르면 전환)`}>
            {theme === "auto" ? "◐ 자동" : theme === "dark" ? "☾ 다크" : "☀ 라이트"}
          </button>
        </div>
      </header>
      <main className="wrap" id="main">{page}</main>
      <footer className="wrap footer">
        <p>데이터: {snap.source} · {fmtAsOf(snap)} · 수집 {snap.generatedAt.slice(0, 16).replace("T", " ")} UTC</p>
        <p>투자 판단의 책임은 투자자 본인에게 있습니다. 이 앱은 정보 제공용이며 투자자문이 아닙니다.</p>
      </footer>
    </>
  );
}

export function App() {
  return (
    <DataProvider>
      <Shell />
    </DataProvider>
  );
}
