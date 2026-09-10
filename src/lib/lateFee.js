/**
 * The Rs 500 late-payment fine.
 *
 * It follows a late deposit, not a stale due date — a fee sitting unpaid for
 * months is not itself fined; the fine is added the moment a payment against it
 * is actually recorded (or verified) after the due date has passed. Applies only
 * to charges due on or after `LATE_FEE_STARTS_FROM`: a fee already overdue when
 * this rule shipped was never fined for a policy the office had not yet
 * announced.
 *
 * Imports nothing, so it is drivable from plain Node — the same discipline as
 * `accounts.js` and `payroll.js`.
 */
export const LATE_FEE_AMOUNT = 500;
export const LATE_FEE_STARTS_FROM = "2026-10-01";

/** Was a payment on `dueDate`, actually made on `paidOnISO`, a late one? */
export function isLatePayment(dueDate, paidOnISO) {
  if (!dueDate || !paidOnISO) return false;
  if (dueDate < LATE_FEE_STARTS_FROM) return false;
  return paidOnISO.slice(0, 10) > dueDate;
}

/** A fee's real total — the charge plus whatever fine sits on it. */
export function totalWithFine(fee) {
  return Number(fee?.amount_due || 0) + Number(fee?.fine_amount || 0);
}

/** The fee's label, with the fine spelled out wherever only a label fits — a
 *  WhatsApp line, a report row, a spreadsheet cell. */
export function feeLabelWithFine(fee) {
  const base = fee?.label || fee?.program || "Fee";
  const fine = Number(fee?.fine_amount || 0);
  return fine > 0 ? `${base} (+ Rs ${fine.toLocaleString()} late fee)` : base;
}
