/**
 * 화면 언어(한국어/영어). 모든 사용자 노출 문장은 `tr(한국어, English)` 로 쓰고, 한국어 원문은 그대로 둔다.
 *
 * 현재 언어는 모듈 전역 하나다. 웹 앱이 `setLang` 으로 바꾸고(src/web/lang.tsx), 언어가 바뀌면 화면 트리를 다시 만든다.
 * 이렇게 해서 core 의 순수 함수(설명 생성기·포맷터)가 시그니처를 바꾸지 않고도 현재 언어로 문장을 만든다.
 * 기본은 한국어라서 언어를 건드리지 않는 테스트·백테스트·수집 스크립트는 이전과 똑같이 동작한다.
 */
export type Lang = "ko" | "en";

export const LANGS: readonly Lang[] = ["ko", "en"];
/** 각 언어를 그 언어 자신의 이름으로 */
export const LANG_NAME: Record<Lang, string> = { ko: "한국어", en: "English" };

let current: Lang = "ko";
export const getLang = (): Lang => current;
export const setLang = (lang: Lang): void => {
  current = lang;
};
export const isEn = (): boolean => current === "en";

/** 저장된 값·외부 입력에서 언어를 안전하게 읽는다. 알 수 없으면 null */
export const parseLang = (v: unknown): Lang | null => (v === "ko" || v === "en" ? v : null);

/** 현재 언어의 문장을 고른다. 두 문장은 항상 함께 계산되므로 값싼 문자열만 넘길 것(템플릿 리터럴은 괜찮다). */
export const tr = (ko: string, en: string): string => (current === "en" ? en : ko);

/** 숫자 서식에 쓰는 로캘 */
export const numLocale = (): string => (current === "en" ? "en-US" : "ko-KR");
/** 천 단위 쉼표. 두 언어 모두 같은 모양이지만 로캘을 한 곳에서 정한다 */
export const fmtNum = (n: number, opts?: Intl.NumberFormatOptions): string => n.toLocaleString(numLocale(), opts);

/**
 * 키별로 한국어/영어를 가진 레코드. 읽을 때마다 현재 언어의 값을 돌려주므로
 * `LABEL[key]` 형태의 기존 호출부를 바꾸지 않고 상수를 두 언어로 만들 수 있다.
 */
export function langRecord<K extends string>(ko: Record<K, string>, en: Record<K, string>): Record<K, string> {
  const out = {} as Record<K, string>;
  for (const k of Object.keys(ko) as K[]) {
    Object.defineProperty(out, k, { enumerable: true, get: () => (current === "en" ? (en[k] ?? ko[k]) : ko[k]) });
  }
  return out;
}

/** 위와 같은 방식의 배열(인덱스·map·length 가 현재 언어의 배열을 따른다) */
export function langArray<T extends string>(ko: readonly T[], en: readonly string[]): readonly string[] {
  return new Proxy([] as string[], {
    get: (_t, p) => Reflect.get(current === "en" ? en : ko, p),
    has: (_t, p) => Reflect.has(current === "en" ? en : ko, p),
  });
}
