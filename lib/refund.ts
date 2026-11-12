/**
 * Whether an `order.refunded` payload from Polar says that the whole order was refunded.
 *
 * Polar sets the status to "refunded" only when the whole order is refunded (a part of it gives
 * "partially_refunded"), so the status decides. The amounts are for a payload without a status:
 * `refunded_amount` is without tax, so it is compared with `net_amount` (also without tax), and
 * with `total_amount` only when the payload has no `net_amount`.
 */
export interface RefundedOrder {
  status?: string;
  net_amount?: number;
  total_amount?: number;
  refunded_amount?: number;
}

export function isFullRefund(order: RefundedOrder): boolean {
  if (order.status) return order.status === "refunded";
  const base = order.net_amount ?? order.total_amount;
  return base != null && base > 0 && order.refunded_amount != null && order.refunded_amount >= base;
}
