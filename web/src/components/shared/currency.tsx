const formatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export function formatPrice(amount: number | null): string {
  if (amount === null) return "Free";
  return formatter.format(amount);
}
