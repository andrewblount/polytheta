import {
  format,
  formatDistanceToNowStrict,
  isToday,
  parseISO,
} from "date-fns";

export function formatCurrency(
  value: number,
  options: Intl.NumberFormatOptions = {},
) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2,
    ...options,
  }).format(value);
}

export function formatPercent(
  value: number,
  digits = 1,
  options: Intl.NumberFormatOptions = {},
) {
  return new Intl.NumberFormat("en-US", {
    style: "percent",
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
    ...options,
  }).format(value);
}

export function formatCompactNumber(value: number) {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatDateLabel(value: string | Date, pattern = "MMM d, yyyy") {
  const date = typeof value === "string" ? parseISO(value) : value;
  return format(date, pattern);
}

export function formatDateTimeLabel(value: string | Date) {
  const date = typeof value === "string" ? parseISO(value) : value;
  return format(date, "MMM d, yyyy 'at' h:mm a");
}

export function formatRelativeTime(value: string | Date) {
  const date = typeof value === "string" ? parseISO(value) : value;
  if (isToday(date)) {
    return `${formatDistanceToNowStrict(date, { addSuffix: true })}`;
  }
  return format(date, "MMM d, h:mm a");
}
