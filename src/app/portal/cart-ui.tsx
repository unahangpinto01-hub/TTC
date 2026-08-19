"use client";

import { useEffect, useState } from "react";

export type CartItem = {
  id: string;
  sku: string;
  name: string;
  packSize: string;
  price: number; // dealer price per PCS
  cartonPrice: number | null; // dealer price per carton (null = not sold by carton)
  piecesPerCarton: number | null;
  unit: "PCS" | "CARTON";
  qty: number;
  stock: number; // PCS
};

const KEY = "tt_cart";

export function readCart(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    const raw: Partial<CartItem>[] = JSON.parse(localStorage.getItem(KEY) || "[]");
    // carts saved before unit support default to PCS
    return raw.map(
      (i) =>
        ({
          ...i,
          cartonPrice: i.cartonPrice ?? null,
          piecesPerCarton: i.piecesPerCarton ?? null,
          unit: i.unit === "CARTON" ? "CARTON" : "PCS",
        }) as CartItem
    );
  } catch {
    return [];
  }
}

export function writeCart(items: CartItem[]) {
  localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new Event("tt-cart-changed"));
}

export function lineKey(i: { id: string; unit: string }) {
  return `${i.id}|${i.unit}`;
}

export function linePrice(i: CartItem): number {
  return i.unit === "CARTON" ? (i.cartonPrice ?? 0) : i.price;
}

export function CartBadge() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const update = () => setCount(readCart().reduce((s, i) => s + i.qty, 0));
    update();
    window.addEventListener("tt-cart-changed", update);
    window.addEventListener("storage", update);
    return () => {
      window.removeEventListener("tt-cart-changed", update);
      window.removeEventListener("storage", update);
    };
  }, []);
  if (!count) return null;
  return (
    <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
      {count}
    </span>
  );
}

export function AddToCartButton({ item, disabled }: { item: Omit<CartItem, "qty" | "unit">; disabled?: boolean }) {
  const [added, setAdded] = useState(false);
  const hasCarton = !!item.piecesPerCarton && item.piecesPerCarton > 0 && item.cartonPrice != null;
  const [unit, setUnit] = useState<"PCS" | "CARTON">(hasCarton ? "CARTON" : "PCS");
  return (
    <div className="flex items-center gap-1.5">
      {hasCarton && (
        <select
          value={unit}
          onChange={(e) => setUnit(e.target.value as "PCS" | "CARTON")}
          className="input w-auto px-2 py-1.5 text-xs"
          aria-label="Unit"
        >
          <option value="CARTON">CTN ({item.piecesPerCarton})</option>
          <option value="PCS">PCS</option>
        </select>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          const cart = readCart();
          const chosen = hasCarton ? unit : "PCS";
          const existing = cart.find((c) => c.id === item.id && c.unit === chosen);
          if (existing) existing.qty += 1;
          else cart.push({ ...item, unit: chosen, qty: 1 });
          writeCart(cart);
          setAdded(true);
          setTimeout(() => setAdded(false), 1200);
        }}
        className={`btn ${disabled ? "cursor-not-allowed bg-gray-200 text-gray-400" : added ? "bg-emerald-100 text-emerald-800" : "bg-emerald-700 text-white hover:bg-emerald-800"}`}
      >
        {disabled ? "Out of Stock" : added ? "✔ Added" : "Add to Cart"}
      </button>
    </div>
  );
}
