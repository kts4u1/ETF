/** localStorage 는 시크릿 모드·차단 환경에서 예외를 던질 수 있어 항상 감싼다. 실패해도 앱은 정상 동작해야 한다. */
export function readJson<T>(key: string): T | null {
  try {
    const v = window.localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

/** 저장에 성공하면 true. 실패(차단·시크릿 모드·용량 초과)해도 앱은 계속 동작해야 하므로 던지지 않지만, 알려야 하는 호출부는 반환값을 본다 */
export function writeJson(key: string, value: unknown): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function writeText(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    /* 무시 */
  }
}

export function readText(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
