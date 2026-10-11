import { tr } from "../../core/i18n";
import { useBasket } from "../basket";

interface Etf {
  code: string;
  name: string;
}

/**
 * 장바구니 담기/빼기 토글. 상태는 aria-pressed 로 전달하고 이름은 바뀌지 않는다("장바구니: 이름").
 * (이름이 "담기"↔"빼기"로 바뀌는 데다 pressed 까지 읽히면 스크린리더가 "빼기, 눌림"처럼 모순되게 읽는다.)
 * 눈으로 보는 상태는 ＋/✓ 와 강조색이고, 누른 결과는 화면 아래 알림(토스트)과 스크린리더 알림으로 따로 전한다.
 * compact 는 표의 한 칸에 들어가는 아이콘형이다. 가득 차도 막지 않고 누르면 이유를 알려 준다.
 */
export function BasketButton({ etf, compact = false }: { etf: Etf; compact?: boolean }) {
  const { has, toggle } = useBasket();
  const on = has(etf.code);
  return (
    <button
      type="button"
      className={`basket-btn${compact ? " compact" : ""}${on ? " on" : ""}`}
      aria-pressed={on}
      aria-label={`${tr("장바구니", "Basket")}: ${etf.name}`}
      title={on ? tr("장바구니에서 빼기", "Remove from basket") : tr("장바구니에 담기", "Add to basket")}
      onClick={() => toggle(etf)}
    >
      <span aria-hidden>{on ? "✓" : "＋"}</span>
      {!compact && <span aria-hidden>{" "}{tr("장바구니", "Basket")}</span>}
    </button>
  );
}
