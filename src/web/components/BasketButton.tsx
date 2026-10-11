import { BASKET_MAX } from "../../core/basket";
import { tr } from "../../core/i18n";
import { useBasket } from "../basket";

interface Etf {
  code: string;
  name: string;
}

/**
 * 장바구니 담기/빼기 토글. 담긴 상태는 색만이 아니라 글자(✓ 담음)와 aria-pressed 로도 전달한다.
 * compact 는 표의 한 칸에 들어가는 아이콘형(＋/✓)이고, 이름은 aria-label 로 읽힌다.
 */
export function BasketButton({ etf, compact = false }: { etf: Etf; compact?: boolean }) {
  const { has, toggle, full } = useBasket();
  const on = has(etf.code);
  const blocked = !on && full;
  const label = on
    ? tr(`${etf.name} 장바구니에서 빼기`, `Remove ${etf.name} from basket`)
    : blocked
      ? tr(`장바구니가 가득 찼습니다(최대 ${BASKET_MAX}개)`, `Basket is full (max ${BASKET_MAX})`)
      : tr(`${etf.name} 장바구니에 담기`, `Add ${etf.name} to basket`);
  return (
    <button
      type="button"
      className={`basket-btn${compact ? " compact" : ""}${on ? " on" : ""}`}
      aria-pressed={on}
      aria-label={label}
      title={label}
      disabled={blocked}
      onClick={() => toggle(etf)}
    >
      <span aria-hidden>{on ? "✓" : "＋"}</span>
      {!compact && <span>{on ? tr(" 담음", " In basket") : tr(" 장바구니 담기", " Add to basket")}</span>}
    </button>
  );
}
