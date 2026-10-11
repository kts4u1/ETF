/**
 * 복사·파일 받기. claude.ai 아티팩트처럼 샌드박스된 iframe 에서는 클립보드 API 나 다운로드가 막힐 수 있어서
 * 실패하면 false 를 돌려주고, 호출한 화면이 직접 복사할 수 있는 대안(텍스트 상자)을 보여 준다.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 아래 대안으로 */
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

/** 텍스트를 파일로 받게 한다. 브라우저가 막는지는 알 수 없어서 "시도했다"만 돌려준다 */
export function downloadText(filename: string, text: string, mime: string): boolean {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    return true;
  } catch {
    return false;
  }
}

export type SaveOutcome = "saved" | "declined" | "unavailable";

/**
 * 파일로 저장한다. claude.ai 아티팩트 안에서는 일반 다운로드 링크가 아무 일도 하지 않으므로(뷰어가 페이지의 직접 다운로드를 허용하지 않는다)
 * 플랫폼의 downloads 기능(window.claude)으로 저장을 요청하고 — 뷰어가 확인창에서 거절할 수 있다 — 그 기능이 없으면 "unavailable"을 돌려
 * 호출한 화면이 텍스트를 직접 복사하게 한다. 아티팩트가 아닌 일반 브라우저에서는 링크로 받는다.
 */
export async function saveFile(filename: string, text: string, mime: string): Promise<SaveOutcome> {
  const claude = (window as unknown as { claude?: { use?: (name: string) => Promise<unknown> } }).claude;
  if (claude && typeof claude.use === "function") {
    try {
      const dl = (await claude.use("downloads")) as { save: (r: { filename: string; data: string }) => Promise<unknown> } | null;
      if (!dl) return "unavailable";
      await dl.save({ filename, data: text });
      return "saved";
    } catch (e) {
      return (e as { code?: string } | null)?.code === "declined" ? "declined" : "unavailable";
    }
  }
  return downloadText(filename, text, mime) ? "saved" : "unavailable";
}
