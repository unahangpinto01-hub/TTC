"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { readCart, writeCart, type CartItem } from "../cart-ui";
import { placePortalOrder } from "../actions";

function peso(n: number) {
  return "₱" + n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function CartView({ allowedTerms }: { allowedTerms: string[] }) {
  const router = useRouter();
  const [items, setItems] = useState<CartItem[]>([]);
  const [term, setTerm] = useState(allowedTerms[0] || "COD");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setItems(readCart());
    setLoaded(true);
  }, []);

  const update = (next: CartItem[]) => {
    setItems(next);
    writeCart(next);
  };

  const total = items.reduce((s, i) => s + i.price * i.qty, 0);

  const checkout = async () => {
    setSubmitting(true);
    setError("");
    const res = await placePortalOrder({ items: items.map((i) => ({ id: i.id, qty: i.qty })), term, notes });
    if (res.ok) {
      writeCart([]);
      router.push("/portal/orders?placed=1");
    } else {
      setError(res.error || "Something went wrong.");
      setSubmitting(false);
    }
  };

  if (!loaded) return null;

  if (!items.length)
    return (
      <div className="rounded-xl border border-dashed border-gray-300 bg-white p-10 text-center text-sm text-gray-500">
        Your cart is empty. Browse the <a href="/portal" className="text-emerald-700 underline">catalog</a> to add products.
      </div>
    );

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-4 text-xl font-bold">Your Cart</h1>
      <div className="card mb-4 divide-y divide-gray-100 p-0">
        {items.map((i) => (
          <div key={i.id} className="flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{i.name}</p>
              <p className="text-xs text-gray-500">{i.sku} · {peso(i.price)} each</p>
            </div>
            <input
              type="number"
              min={1}
              value={i.qty}
              onChange={(e) => update(items.map((x) => (x.id === i.id ? { ...x, qty: Math.max(1, Number(e.target.value) || 1) } : x)))}
              className="input w-20 text-right"
            />
            <p className="w-28 text-right font-semibold">{peso(i.price * i.qty)}</p>
            <button type="button" onClick={() => update(items.filter((x) => x.id !== i.id))} className="text-sm text-red-600 hover:underline">
              Remove
            </button>
          </div>
        ))}
      </div>

      <div className="card space-y-4">
        <div className="flex items-center justify-between">
          <p className="font-semibold">Total (VAT inclusive)</p>
          <p className="text-2xl font-bold">{peso(total)}</p>
        </div>
        <div>
          <label className="label">Payment Term</label>
          <div className="flex flex-wrap gap-3">
            {allowedTerms.map((t) => (
              <label key={t} className={`flex cursor-pointer items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm ${term === t ? "border-emerald-600 bg-emerald-50 font-semibold" : "border-gray-300"}`}>
                <input type="radio" name="term" value={t} checked={term === t} onChange={() => setTerm(t)} className="hidden" />
                {t === "COD" ? "COD" : `${t} days`}
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="label">Notes (optional)</label>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="input" rows={2} placeholder="Delivery instructions, urgency, etc." />
        </div>
        {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
        <button onClick={checkout} disabled={submitting} className="btn-primary w-full justify-center py-2.5">
          {submitting ? "Placing order…" : `Place Order · ${peso(total)}`}
        </button>
        <p className="text-center text-xs text-gray-500">No online payment — billed on your selected term after delivery.</p>
      </div>
    </div>
  );
}
