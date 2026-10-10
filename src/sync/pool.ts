/** 동시 실행 수를 제한하며 items 를 처리한다. 개별 실패는 results 에 기록하고 전체를 멈추지 않는다. */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<{ results: (R | undefined)[]; errors: Map<number, unknown> }> {
  const results: (R | undefined)[] = new Array(items.length);
  const errors = new Map<number, unknown>();
  let next = 0;
  let done = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i] as T, i);
      } catch (e) {
        errors.set(i, e);
      }
      done++;
      onProgress?.(done, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return { results, errors };
}
