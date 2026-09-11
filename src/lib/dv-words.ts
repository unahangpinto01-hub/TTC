/** ₱12,345.60 → "Twelve Thousand Three Hundred Forty-Five Pesos and 60/100 Only" — the paper form's line. Pure, safe in the browser. */

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const SCALES = ["", "Thousand", "Million", "Billion"];

function chunk(n: number): string {
  const h = Math.floor(n / 100), r = n % 100;
  const parts: string[] = [];
  if (h) parts.push(`${ONES[h]} Hundred`);
  if (r >= 20) parts.push(`${TENS[Math.floor(r / 10)]}${r % 10 ? `-${ONES[r % 10]}` : ""}`);
  else if (r) parts.push(ONES[r]);
  return parts.join(" ");
}

export function amountInWords(amount: number): string {
  const whole = Math.floor(Math.abs(amount) + 1e-9);
  const cents = Math.round((Math.abs(amount) - whole) * 100);
  if (whole === 0 && cents === 0) return "Zero Pesos Only";
  const parts: string[] = [];
  let n = whole, i = 0;
  while (n > 0) {
    const c = n % 1000;
    if (c) parts.unshift(`${chunk(c)}${SCALES[i] ? ` ${SCALES[i]}` : ""}`);
    n = Math.floor(n / 1000); i++;
  }
  const pesos = whole ? `${parts.join(" ")} Peso${whole === 1 ? "" : "s"}` : "";
  return `${pesos}${cents ? `${pesos ? " and " : ""}${String(cents).padStart(2, "0")}/100` : ""} Only`.trim();
}
