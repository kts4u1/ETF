import { useEffect, useState } from "react";

export type RouteName = "home" | "explore" | "etf" | "compare" | "combo" | "learn" | "method";

export interface Route {
  name: RouteName;
  /** /etf/069500 의 069500 */
  param: string | null;
  query: URLSearchParams;
}

/** 해시 라우팅: 정적 호스팅(서버 설정 없이)에서도 새로고침·직접 링크가 동작한다. */
export function parseHash(hash: string): Route {
  const raw = hash.replace(/^#/, "") || "/";
  const [path = "/", search = ""] = raw.split("?");
  const parts = path.split("/").filter(Boolean);
  const query = new URLSearchParams(search);
  const head = parts[0];
  switch (head) {
    case "explore":
    case "compare":
    case "combo":
    case "learn":
    case "method":
      return { name: head, param: null, query };
    case "etf":
      return { name: "etf", param: parts[1] ?? null, query };
    default:
      return { name: "home", param: null, query };
  }
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));
  useEffect(() => {
    const on = () => {
      setRoute(parseHash(window.location.hash));
      window.scrollTo({ top: 0 });
    };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export const href = (path: string) => `#${path}`;
export const etfHref = (code: string) => href(`/etf/${code}`);
export const compareHref = (codes: string[]) => href(`/compare?codes=${codes.join(",")}`);
