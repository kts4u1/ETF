import { useEffect, useMemo, useRef, useState } from "react";
import { BASKET_MAX, NOTE_MAX, basketHash, parseCodeText, resolveCodes, type BasketItem } from "../../core/basket";
import { toCodeList, toCsv, toSummaryText, type BasketRow } from "../../core/basket-export";
import { typeLine } from "../../core/explain";
import { fmtAsOf, fmtFee, fmtRatio, priceParts } from "../../core/format";
import { fmtNum, numLocale, tr } from "../../core/i18n";
import { isOverseas } from "../../core/market";
import { aumFundNote, aumText, fxNote } from "../../core/market-view";
import { mddOf } from "../../core/scoring";
import type { EtfRecord } from "../../core/types";
import { localToday, useBasket } from "../basket";
import { copyText, saveFile } from "../clipboard";
import { Delta, Disclaimer, FxNote, MarketBadge } from "../components/bits";
import { useApp } from "../data";
import { compareHref, etfHref, href } from "../router";

type SortKey = "added" | "name" | "y1" | "cagr3y" | "mdd" | "fee" | "aum";

const sortLabel = (k: SortKey): string =>
  ({
    added: tr("담은 순서", "Date added (oldest first)"),
    name: tr("이름", "Name"),
    y1: tr("최근 1년", "Last 1 year"),
    cagr3y: tr("3년 연평균", "3-year CAGR"),
    mdd: tr("최대낙폭(작은 순)", "Max drawdown (smallest first)"),
    fee: tr("총보수(낮은 순)", "Expense ratio (lowest first)"),
    aum: tr("순자산(큰 순)", "Net assets (largest first)"),
  })[k];
const SORTS: SortKey[] = ["added", "name", "y1", "cagr3y", "mdd", "fee", "aum"];

/** 정렬 값. 숫자는 클수록 앞(내림차순), 문자열은 가나다·ABC 순. null(데이터 없음)은 항상 맨 뒤 */
function sortValue(r: BasketRow, k: SortKey): number | string | null {
  const e = r.etf;
  if (k === "name") return e?.name ?? r.item.name;
  if (!e) return null;
  switch (k) {
    case "y1": return e.m.ret.y1;
    case "cagr3y": return e.m.cagr3y;
    case "mdd": return mddOf(e); // 음수: 0 에 가까울수록(작은 낙폭) 큰 값
    case "fee": return e.fee === null ? null : -e.fee; // 낮을수록 앞
    case "aum": return e.aumScope === "fund" ? null : e.aumEok; // † 펀드 합계는 순위에서 뺀다
    default: return null;
  }
}

/**
 * 메모 입력. 입력 중에는 다른 탭의 변경이 입력을 덮어쓰지 않고, 입력 중에 화면이 바뀌어(뒤로 가기·언어 전환) 입력이 사라질 때도
 * 마지막 값을 저장한다(blur 가 오지 않는 경로).
 */
function NoteCell({ item }: { item: BasketItem }) {
  const { setNote } = useBasket();
  const [v, setV] = useState(item.note);
  const focused = useRef(false);
  const latest = useRef({ v, item });
  latest.current = { v, item };
  useEffect(() => {
    if (!focused.current) setV(item.note);
  }, [item.note]);
  useEffect(
    () => () => {
      const { v: last, item: it } = latest.current;
      if (last.trim() !== it.note) setNote(it.code, last);
    },
    [], // eslint-disable-line react-hooks/exhaustive-deps -- 언마운트할 때만. setNote 는 항상 최신 목록 위에서 계산한다
  );
  const commit = () => {
    if (v.trim() !== item.note) setNote(item.code, v);
  };
  return (
    <input
      type="text"
      className="note-input"
      value={v}
      maxLength={NOTE_MAX}
      placeholder={tr("메모 (예: 분할 매수)", "Note (e.g. buy in parts)")}
      aria-label={tr(`${item.name} 메모`, `Note for ${item.name}`)}
      onFocus={() => { focused.current = true; }}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => { focused.current = false; commit(); }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setV(item.note);
      }}
    />
  );
}

/** 다른 페이지 안(iframe)에 들어 있으면 이 화면의 주소를 그대로 공유할 수 없다(예: claude.ai 아티팩트는 겉 주소와 안쪽 주소가 다르다) */
const isEmbedded = (): boolean => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
};

/** 주소의 ?codes=… 를 지운다. 뒤로 가기에 배너가 다시 나타나지 않도록 현재 항목을 바꿔치기한다(막히면 해시만 바꾼다) */
function clearQuery(): void {
  try {
    window.history.replaceState(null, "", `${window.location.href.split("#")[0]}${href("/basket")}`);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  } catch {
    window.location.hash = href("/basket");
  }
}

type Focus = { kind: "rm"; code: string } | { kind: "cancel" } | { kind: "clear" } | { kind: "empty" };

interface Preview {
  found: EtfRecord[];
  unknown: string[];
  /** 체크 해제한 코드 */
  off: string[];
}

export function Basket({ incoming }: { incoming: string[] }) {
  const { snap, byCode } = useApp();
  const bk = useBasket();
  const lookup = (c: string): EtfRecord | undefined => byCode.get(c) ?? byCode.get(c.toUpperCase());
  const [sort, setSort] = useState<SortKey>("added");
  const [sel, setSel] = useState<string[]>([]);
  const [status, setStatus] = useState<{ warn: boolean; text: string; action?: { label: string; run: () => void } } | null>(null);
  const [manual, setManual] = useState<{ title: string; text: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const embedded = useMemo(isEmbedded, []);
  const [paste, setPaste] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [impOpen, setImpOpen] = useState(bk.items.length === 0);
  const [focus, setFocus] = useState<Focus | null>(null);

  const rows: BasketRow[] = useMemo(() => bk.items.map((item) => ({ item, etf: byCode.get(item.code) ?? byCode.get(item.code.toUpperCase()) ?? null })), [bk.items, byCode]);
  const sorted = useMemo(() => {
    if (sort === "added") return rows;
    const loc = numLocale();
    return [...rows].sort((a, b) => {
      const va = sortValue(a, sort);
      const vb = sortValue(b, sort);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return typeof va === "string" ? va.localeCompare(vb as string, loc) : (vb as number) - va;
    });
  }, [rows, sort]);

  // 삭제·비우기 뒤에 포커스가 사라진 요소에 남아 화면 맨 위로 튕기지 않게, 다음 항목·확인 버튼·빈 상태 안내로 옮긴다
  useEffect(() => {
    if (!focus) return;
    const q = focus.kind === "rm" ? `[data-rm="${CSS.escape(focus.code)}"]` : `[data-focus="${focus.kind}"]`;
    (document.querySelector(q) as HTMLElement | null)?.focus();
    setFocus(null);
  }, [focus]);

  // 선택(비교용)은 장바구니에 남아 있는 코드만 유효하다
  const selValid = sel.filter((c) => bk.has(c) && lookup(c));
  const present = rows.filter((r) => r.etf);
  const hasOverseas = present.some((r) => isOverseas(r.etf!));
  const krN = present.filter((r) => !isOverseas(r.etf!)).length;
  const usN = present.length - krN;
  const missing = rows.length - present.length;

  // 링크(#/basket?codes=…)로 받은 목록: 자동으로 담지 않고 확인을 받는다
  const incKey = incoming.join(",");
  const inc = useMemo(() => resolveCodes(incoming, (c) => byCode.get(c) ?? byCode.get(c.toUpperCase())), [incKey, byCode]); // incoming 은 렌더마다 새 배열이라 내용(incKey)으로 비교한다
  const incNew = inc.found.filter((e) => !bk.has(e.code));

  const done = (text: string, warn = false, action?: { label: string; run: () => void }) => setStatus({ warn, text, action });
  const copy = async (title: string, text: string) => {
    if (await copyText(text)) {
      setManual(null);
      done(tr(`${title}을(를) 복사했어요.`, `Copied ${title}.`));
    } else {
      setManual({ title, text });
      done(tr("자동 복사가 막혀 있어요. 아래 내용을 직접 선택해서 복사하세요.", "Automatic copy is blocked here. Select the text below and copy it yourself."), true);
    }
  };
  const meta = { asOf: snap.asOf, asOfUs: snap.asOfUs };
  const shareUrl = () => `${window.location.href.split("#")[0]}${basketHash(bk.items.map((i) => i.code))}`;

  const removeRow = (code: string) => {
    const i = sorted.findIndex((r) => r.item.code === code);
    const next = sorted[i + 1] ?? sorted[i - 1];
    bk.remove(code);
    setSel((c) => c.filter((x) => x !== code));
    setFocus(next ? { kind: "rm", code: next.item.code } : { kind: "empty" });
  };

  /** 1단계: 붙여넣은 글에서 코드를 찾아 미리 보여 준다(이름 속 단어가 우연히 다른 ETF 의 티커와 같을 수 있어 담기 전에 확인) */
  const doPreview = () => {
    const tokens = parseCodeText(paste);
    setImportMsg(null);
    if (tokens.length === 0) {
      setPreview(null);
      setImportMsg(tr("코드를 찾지 못했어요. 한 줄에 하나씩(069500, SPY …) 또는 쉼표로 구분해 붙여넣으세요.", "No codes found. Paste one per line (069500, SPY …) or separated by commas."));
      return;
    }
    const r = resolveCodes(tokens, lookup);
    if (r.found.length === 0) {
      setPreview(null);
      setImportMsg(tr(`데이터에서 찾은 ETF가 없어요. 읽은 코드: ${r.unknown.slice(0, 8).join(", ")}${r.unknown.length > 8 ? " …" : ""}`, `None of these were found in the data. Codes read: ${r.unknown.slice(0, 8).join(", ")}${r.unknown.length > 8 ? " …" : ""}`));
      return;
    }
    setPreview({ found: r.found, unknown: r.unknown, off: [] });
  };
  /** 2단계: 체크한 것만 담는다 */
  const doImport = () => {
    if (!preview) return;
    const chosen = preview.found.filter((e) => !preview.off.includes(e.code));
    const add = bk.add(chosen);
    const parts = [tr(`${add.added}개를 담았어요`, `Added ${add.added}`)];
    if (add.existing) parts.push(tr(`이미 있던 ${add.existing}개`, `${add.existing} already in basket`));
    if (add.full) parts.push(tr(`가득 차서 못 담은 ${add.full}개(최대 ${BASKET_MAX}개)`, `${add.full} not added: basket full (max ${BASKET_MAX})`));
    if (preview.unknown.length) parts.push(tr(`데이터에 없는 코드 ${preview.unknown.length}개: ${preview.unknown.slice(0, 8).join(", ")}${preview.unknown.length > 8 ? " …" : ""}`, `${preview.unknown.length} codes not in the data: ${preview.unknown.slice(0, 8).join(", ")}${preview.unknown.length > 8 ? " …" : ""}`));
    setImportMsg(parts.join(" · ") + ".");
    setPreview(null);
    setPaste("");
  };

  const toggleSel = (code: string) => setSel((cur) => (cur.includes(code) ? cur.filter((c) => c !== code) : cur.length >= 4 ? cur : [...cur, code]));

  return (
    <>
      <h1>{tr("장바구니", "Basket")}</h1>
      <p className="lead">
        {bk.saveFailed
          ? tr("마음에 드는 ETF를 모아 두고, 증권사 앱의 관심종목에 등록하거나 매매 전에 다시 확인할 때 쓰세요.", "Collect the ETFs you like, then use the list to add them to your brokerage app's watchlist or to re-check before you trade.")
          : tr(
              "마음에 드는 ETF를 모아 두고, 증권사 앱의 관심종목에 등록하거나 매매 전에 다시 확인할 때 쓰세요. 목록은 이 기기·브라우저에만 저장됩니다(서버로 보내지 않아요).",
              "Collect the ETFs you like, then use the list to add them to your brokerage app's watchlist or to re-check before you trade. The list is saved only on this device and browser (nothing is sent to a server).",
            )}
      </p>
      {bk.saveFailed && (
        <p className="card notice save-failed" role="alert">
          <b>{tr("이 브라우저에서는 목록이 저장되지 않아요.", "This browser is not saving the list.")}</b>{" "}
          {tr("지금은 보이지만 새로고침하거나 창을 닫으면 사라져요(시크릿 모드이거나 저장이 막혀 있을 수 있어요). 오래 쓸 목록은 ‘목록 복사’나 ‘코드 복사’로 따로 보관하세요.", "It shows now, but it disappears when you refresh or close the window (this may be a private window, or storage may be blocked). Keep a list you care about with “Copy list” or “Copy codes”.")}
        </p>
      )}

      {incoming.length > 0 && (
        <section className="card notice" aria-labelledby="inc-h">
          <h2 id="inc-h">{tr("링크로 받은 목록", "List from a link")}</h2>
          <p>
            {tr(
              `링크에 ETF ${incoming.length}개가 들어 있어요. 데이터에서 ${inc.found.length}개를 찾았고 그중 ${incNew.length}개가 아직 장바구니에 없어요.`,
              `The link has ${incoming.length} ETFs. ${inc.found.length} were found in the data and ${incNew.length} are not in your basket yet.`,
            )}
            {inc.unknown.length > 0 && tr(` 데이터에 없는 코드: ${inc.unknown.slice(0, 8).join(", ")}${inc.unknown.length > 8 ? " …" : ""}`, ` Codes not in the data: ${inc.unknown.slice(0, 8).join(", ")}${inc.unknown.length > 8 ? " …" : ""}`)}
          </p>
          {inc.found.length > 0 && <ul className="plain">{inc.found.slice(0, 12).map((e) => <li key={e.code}><b>{e.name}</b> <span className="muted">{e.code}</span>{bk.has(e.code) && <span className="muted"> · {tr("이미 담김", "already added")}</span>}</li>)}{inc.found.length > 12 && <li className="muted">{tr(`… 외 ${inc.found.length - 12}개`, `… and ${inc.found.length - 12} more`)}</li>}</ul>}
          <span className="actions">
            {incNew.length > 0 && (
              <button type="button" className="btn" onClick={() => {
                const r = bk.add(incNew);
                done(tr(`${r.added}개를 장바구니에 담았어요${r.full ? ` (가득 차서 ${r.full}개는 못 담음)` : ""}.`, `Added ${r.added} to the basket${r.full ? ` (${r.full} not added: basket full)` : ""}.`), r.full > 0);
                clearQuery();
              }}>{tr(`${incNew.length}개 장바구니에 담기`, `Add ${incNew.length} to basket`)}</button>
            )}
            <button type="button" className="btn ghost" onClick={clearQuery}>{tr("닫기", "Dismiss")}</button>
          </span>
        </section>
      )}

      {rows.length === 0 ? (
        <div className="card empty">
          <p><b tabIndex={-1} data-focus="empty">{tr("장바구니가 비어 있어요.", "Your basket is empty.")}</b></p>
          <p>{tr("추천·탐색·상세·비교 화면의 ‘＋ 장바구니’ 버튼으로 담을 수 있어요.", "Use the “＋ Basket” buttons on Picks, Explore, Detail and Compare.")}</p>
          <span className="actions">
            <a className="btn" href={href("/")}>{tr("추천 보기", "See picks")}</a>
            <a className="btn ghost" href={href("/explore")}>{tr("ETF 탐색", "Explore ETFs")}</a>
          </span>
        </div>
      ) : (
        <>
          <section className="card basket-bar" aria-label={tr("장바구니 도구", "Basket tools")}>
            <div className="basket-summary">
              <b>{tr(`${rows.length}개`, `${rows.length} ETFs`)}</b>
              <span className="muted">
                {tr(`국내 ${krN} · 해외 ${usN}`, `Korea ${krN} · US ${usN}`)}
                {missing > 0 && tr(` · 데이터에 없음 ${missing}`, ` · ${missing} not in current data`)}
                {` · ${fmtAsOf(snap)}`}
              </span>
            </div>
            <div className="basket-actions">
              <label className="select"><span>{tr("정렬", "Sort")}</span>
                <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)}>
                  {SORTS.map((k) => <option key={k} value={k}>{sortLabel(k)}</option>)}
                </select>
              </label>
              <button type="button" className="btn ghost" onClick={() => copy(tr("코드 목록", "code list"), toCodeList(sorted))} title={tr("증권사 앱 검색창에 하나씩 붙여넣을 코드·티커", "Codes and tickers to paste into your brokerage app's search")}>{tr("코드 복사", "Copy codes")}</button>
              <button type="button" className="btn ghost" onClick={() => copy(tr("요약 목록", "summary"), toSummaryText(sorted, meta))} title={tr("이름·코드·가격·수익률을 메모 앱에 붙일 수 있는 글로", "Names, codes, prices and returns as text for a notes app")}>{tr("목록 복사", "Copy list")}</button>
              <button type="button" className="btn ghost" onClick={async () => {
                const csv = toCsv(sorted, meta);
                const out = await saveFile(`etf-basket-${localToday()}.csv`, csv, "text/csv");
                if (out === "saved") {
                  done(tr("CSV 파일을 저장했어요. 열리지 않거나 저장이 안 됐다면 내용을 직접 복사하세요.", "Saved the CSV file. If it did not save, copy the contents yourself."), false, { label: tr("내용 보기", "Show contents"), run: () => setManual({ title: "CSV", text: csv }) });
                } else if (out === "declined") {
                  done(tr("CSV 저장을 취소했어요.", "CSV save cancelled."));
                } else {
                  setManual({ title: "CSV", text: csv });
                  done(tr("이 화면에서는 파일을 저장할 수 없어요. 아래 내용을 직접 복사하세요.", "Cannot save a file here. Copy the text below."), true);
                }
              }}>{tr("CSV 받기", "Download CSV")}</button>
              {!embedded && <button type="button" className="btn ghost" onClick={() => copy(tr("링크", "link"), shareUrl())} title={tr("다른 기기에서 열면 이 목록을 담을 수 있어요(메모는 제외)", "Open on another device to add this list (notes not included)")}>{tr("링크 복사", "Copy link")}</button>}
              {selValid.length >= 2 && <a className="btn" href={compareHref(selValid)}>{tr(`선택한 ${selValid.length}개 비교`, `Compare ${selValid.length} selected`)}</a>}
              {!confirmClear ? (
                <button type="button" className="btn ghost danger" data-focus="clear" onClick={() => { setConfirmClear(true); setFocus({ kind: "cancel" }); }}>{tr("모두 비우기", "Clear all")}</button>
              ) : (
                <span
                  className="confirm"
                  role="group"
                  aria-label={tr("모두 비우기 확인", "Confirm clearing")}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      setConfirmClear(false);
                      setFocus({ kind: "clear" });
                    }
                  }}
                >
                  {tr(`${rows.length}개를 모두 비울까요?`, `Clear all ${rows.length}?`)}
                  <button type="button" className="btn ghost" data-focus="cancel" onClick={() => { setConfirmClear(false); setFocus({ kind: "clear" }); }}>{tr("취소", "Cancel")}</button>
                  <button type="button" className="btn danger" onClick={() => { bk.clear(); setConfirmClear(false); setSel([]); setFocus({ kind: "empty" }); }}>{tr("비우기", "Clear")}</button>
                </span>
              )}
            </div>
            <div className="basket-status-row">
              <p className={`basket-status${status?.warn ? " warn" : ""}`} role="status" aria-live="polite">{status?.text ?? ""}</p>
              {status?.action && <button type="button" className="link-btn" onClick={status.action.run}>{status.action.label}</button>}
            </div>
            {manual && (
              <div className="manual-copy">
                <label>
                  <span className="muted">{tr(`${manual.title} — 전체 선택 후 복사하세요`, `${manual.title} — select all and copy`)}</span>
                  <textarea readOnly value={manual.text} rows={Math.min(12, manual.text.split("\n").length + 1)} onFocus={(e) => e.currentTarget.select()} />
                </label>
                <button type="button" className="btn ghost" onClick={() => setManual(null)}>{tr("닫기", "Close")}</button>
              </div>
            )}
          </section>

          <div className="table-wrap">
            <table className="table basket-table">
              <thead>
                <tr>
                  <th aria-label={tr("비교 선택", "Select to compare")} />
                  <th>ETF</th>
                  <th className="num">{tr("가격", "Price")}</th>
                  <th className="num">{tr("최근 1년", "Last 1Y")}</th>
                  <th className="num">{tr("3년 연평균", "3Y CAGR")}</th>
                  <th className="num">{tr("최대낙폭", "Max drawdown")}</th>
                  <th className="num">{tr("총보수", "Fee")}</th>
                  <th className="num">{tr("순자산", "Net assets")}</th>
                  <th>{tr("담은 날", "Date added")}</th>
                  <th>{tr("메모", "Note")}</th>
                  <th aria-label={tr("빼기", "Remove")} />
                </tr>
              </thead>
              <tbody>
                {sorted.map(({ item, etf }) => {
                  const p = etf ? priceParts(etf) : null;
                  return (
                    <tr key={item.code}>
                      <td className="c-sel">{etf && <label className="tap-check"><input type="checkbox" checked={sel.includes(item.code)} disabled={!sel.includes(item.code) && sel.length >= 4} onChange={() => toggleSel(item.code)} aria-label={tr(`${etf.name} 비교에 추가`, `Add ${etf.name} to comparison`)} /></label>}</td>
                      <td className="name-cell c-name">
                        {etf ? <a href={etfHref(etf.code)}>{etf.name}</a> : <b>{item.name}</b>}
                        <span className="muted">{etf && <><MarketBadge etf={etf} />{" "}</>}<span className="code">{item.code}</span>{etf ? ` · ${typeLine(etf)}` : ""}</span>
                      </td>
                      {etf && p ? (
                        <>
                          <td className="num c-price" data-label={tr("가격", "Price")}>{p.main}{p.sub && <><br /><small className="muted">{p.sub}</small></>}</td>
                          <td className="num c-y1" data-label={tr("최근 1년", "Last 1Y")}><Delta v={etf.m.ret.y1} /></td>
                          <td className="num c-cagr" data-label={tr("3년 연평균", "3Y CAGR")}><Delta v={etf.m.cagr3y} /></td>
                          <td className="num c-mdd" data-label={tr("최대낙폭", "Max drawdown")}>{fmtRatio(mddOf(etf), 0)}</td>
                          <td className="num c-fee" data-label={tr("총보수", "Fee")}>{fmtFee(etf.fee)}</td>
                          <td className="num c-aum" data-label={tr("순자산", "Net assets")} title={etf.aumScope === "fund" ? aumFundNote() : undefined}>{aumText(etf)}</td>
                        </>
                      ) : (
                        <td colSpan={6} className="muted c-miss">{tr("현재 데이터에 없음 — 상장폐지되었거나 수집 기준 밖일 수 있어요. 증권사 앱에서 직접 확인하세요.", "Not in the current data — it may be delisted or outside the collection criteria. Check in your brokerage app.")}</td>
                      )}
                      <td className="muted nowrap c-added" data-label={tr("담은 날", "Date added")}>{item.addedAt || "-"}</td>
                      <td className="c-note"><NoteCell item={item} /></td>
                      <td className="c-rm"><button type="button" className="icon-btn" data-rm={item.code} onClick={() => removeRow(item.code)} aria-label={tr(`${item.name} 장바구니에서 빼기`, `Remove ${item.name} from basket`)} title={tr("빼기", "Remove")}>✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {present.some((r) => r.etf!.aumScope === "fund") && <p className="hint">{aumFundNote()}</p>}
          {hasOverseas && <FxNote>{fxNote()} {tr("— 해외(미국) ETF의 가격 아래 작은 글씨, 수익률·순자산은 이 환산값입니다. 증권사 앱에서는 달러로 거래됩니다.", "— the small figure under a US ETF's price, plus returns and net assets, use this converted value. Your brokerage app trades it in dollars.")}</FxNote>}
          <p className="hint">{tr("가격은 데이터 기준일의 종가이며 실시간 시세가 아닙니다. 주문 전에 증권사 앱에서 현재가를 확인하세요.", "Prices are closing prices as of the data date, not real-time quotes. Check the current price in your brokerage app before you order.")}</p>
          <p className="hint">{tr(`지금 담은 ${fmtNum(rows.length)}개 · 최대 ${BASKET_MAX}개. 브라우저의 사이트 데이터를 지우면 목록도 사라지니, 중요한 목록은 ‘목록 복사’${embedded ? "" : "나 ‘링크 복사’"}로 따로 보관하세요.`, `${fmtNum(rows.length)} in basket · max ${BASKET_MAX}. Clearing the browser's site data also clears this list, so keep an important list elsewhere with “Copy list”${embedded ? "" : " or “Copy link”"}.`)}</p>
        </>
      )}

      <section className="card" aria-labelledby="imp-h">
        <details open={impOpen} onToggle={(e) => setImpOpen(e.currentTarget.open)}>
          <summary id="imp-h"><b>{tr("코드 목록으로 한꺼번에 담기", "Add many by pasting codes")}</b></summary>
          <p className="muted">{tr("증권사 앱의 관심종목, 메모, 이 앱에서 복사한 ‘목록’·‘CSV’를 그대로 붙여넣어도 코드를 찾아요. 국내는 6자리 코드, 해외는 티커입니다.", "Paste codes from your brokerage watchlist, notes, or a list/CSV copied from this app — it finds the codes. Korea-listed ETFs use 6-character codes, US-listed ETFs use tickers.")} {tr("다른 기기로 옮길 때는 이 기기에서 ‘목록 복사’(또는 ‘코드 복사’)한 글을 다른 기기의 이 칸에 붙여넣으세요.", "To move the list to another device, use “Copy list” (or “Copy codes”) here and paste it into this box on the other device.")}</p>
          <label className="paste">
            <span className="sr-only">{tr("붙여넣을 코드 목록", "Codes to paste")}</span>
            <textarea value={paste} onChange={(e) => { setPaste(e.target.value); setPreview(null); setImportMsg(""); }} rows={4} placeholder={tr("여기에 붙여넣으세요 (비어 있는 칸이에요)", "Paste here (this box is empty)")} spellCheck={false} />
          </label>
          <span className="actions">
            <button type="button" className="btn" onClick={doPreview} disabled={paste.trim() === ""}>{tr("찾아서 확인하기", "Find and review")}</button>
            {(paste !== "" || preview || importMsg) && <button type="button" className="btn ghost" onClick={() => { setPaste(""); setPreview(null); setImportMsg(""); }}>{tr("입력 지우기", "Clear input")}</button>}
          </span>
          {preview && (
            <div className="import-preview" role="group" aria-label={tr("찾은 ETF 확인", "Review found ETFs")}>
              <p><b>{tr(`${preview.found.length}개를 찾았어요. 담을 것을 확인하세요.`, `Found ${preview.found.length}. Check what to add.`)}</b> <span className="muted">{tr("이름 속 단어가 우연히 다른 ETF의 티커와 같을 수 있어요.", "A word in a name can coincide with another ETF's ticker.")}</span></p>
              <ul className="plain checks">
                {preview.found.map((e) => {
                  const already = bk.has(e.code);
                  return (
                    <li key={e.code}>
                      <label className="check inline">
                        <input type="checkbox" checked={!already && !preview.off.includes(e.code)} disabled={already} onChange={() => setPreview({ ...preview, off: preview.off.includes(e.code) ? preview.off.filter((c) => c !== e.code) : [...preview.off, e.code] })} />
                        <span><MarketBadge etf={e} /> <b>{e.name}</b> <span className="muted">{e.code}{already ? ` · ${tr("이미 담김", "already added")}` : ""}</span></span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              {preview.unknown.length > 0 && <p className="muted">{tr(`데이터에 없는 코드 ${preview.unknown.length}개(건너뜀): ${preview.unknown.slice(0, 8).join(", ")}${preview.unknown.length > 8 ? " …" : ""}`, `${preview.unknown.length} codes not in the data (skipped): ${preview.unknown.slice(0, 8).join(", ")}${preview.unknown.length > 8 ? " …" : ""}`)}</p>}
              <span className="actions">
                <button type="button" className="btn" onClick={doImport} disabled={preview.found.every((e) => bk.has(e.code) || preview.off.includes(e.code))}>
                  {tr(`선택한 ${preview.found.filter((e) => !bk.has(e.code) && !preview.off.includes(e.code)).length}개 담기`, `Add ${preview.found.filter((e) => !bk.has(e.code) && !preview.off.includes(e.code)).length} selected`)}
                </button>
                <button type="button" className="btn ghost" onClick={() => setPreview(null)}>{tr("취소", "Cancel")}</button>
              </span>
            </div>
          )}
          {importMsg && <p className="basket-status" role="status">{importMsg}</p>}
        </details>
      </section>
      <Disclaimer compact />
    </>
  );
}
