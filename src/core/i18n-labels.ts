/**
 * 데이터에 한국어로 들어 있는 분류 이름(테마)·운용사 이름을 영어 화면에서 바꿔 보여주는 표.
 * 데이터(snapshot.json)의 값은 그대로 두고 화면에서만 바꾼다 — 필터·그룹 비교는 한국어 원본 값으로 한다.
 * 표에 없는 값은 원문을 그대로 보여준다(ETF 이름처럼 공식 명칭인 것은 번역하지 않는다).
 */
import { getLang } from "./i18n";

/** 분류기가 만드는 테마 이름 → 영어. 구현은 번역 담당이 채운다. */
export const THEME_EN: Record<string, string> = {};
/** 주요 운용사 이름 → 영어 */
export const ISSUER_EN: Record<string, string> = {};

/** 백테스트 전략 이름(backtest.json 의 combos 키, 데이터라서 한국어 그대로 둔다) → 영어 */
export const STRATEGY_EN: Record<string, string> = {};

export const themeLabel = (theme: string | null): string | null => (theme !== null && getLang() === "en" ? (THEME_EN[theme] ?? theme) : theme);
export const issuerLabel = (issuer: string | null): string | null => (issuer !== null && getLang() === "en" ? (ISSUER_EN[issuer] ?? issuer) : issuer);
export const strategyLabel = (key: string): string => (getLang() === "en" ? (STRATEGY_EN[key] ?? key) : key);
