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
