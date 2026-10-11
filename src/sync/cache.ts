import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";

/** 캐시 파일에 찍는 날짜(UTC, YYYYMMDD). 같은 날 받은 캐시만 재사용한다. */
export const today = () => new Date().toISOString().slice(0, 10).replace(/-/g, "");

export interface Cached<T> {
  fetchedOn: string;
  data: T;
}

export async function readCache<T>(path: string): Promise<Cached<T> | null> {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf8")) as Cached<T>;
  } catch {
    return null;
  }
}

/** 같은 날 받은 캐시가 있으면 재사용하고, 없으면 load 로 받아 저장한다. */
export async function cachedJson<T>(path: string, force: boolean, load: () => Promise<T>): Promise<T> {
  if (!force) {
    const c = await readCache<T>(path);
    if (c && c.fetchedOn === today()) return c.data;
  }
  const data = await load();
  await writeFile(path, JSON.stringify({ fetchedOn: today(), data } satisfies Cached<T>));
  return data;
}
