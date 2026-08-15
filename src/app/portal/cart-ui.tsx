"use client";

import { useEffect, useState } from "react";

export type CartItem = {
  id: string;
  sku: string;
  name: string;
  packSize: string;
  price: number;
  qty: number;
  stock: number;
};

const KEY = "tt_cart";

export function readCart(): CartItem[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

export function writeCart(items: CartItem[]) {
  localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new Event("tt-cart-changed"));
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

export function AddToCartButton({ item, disabled }: { item: Omit<CartItem, "qty">; disabled?: boolean }) {
  const [added, setAdded] = useState(false);
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => {
        const cart = readCart();
        const existing = cart.find((c) => c.id === item.id);
        if (existing) existing.qty += 1;
        else cart.push({ ...item, qty: 1 });
        writeCart(cart);
        setAdded(true);
        setTimeout(() => setAdded(false), 1200);
      }}
      className={`btn ${disabled ? "cursor-not-allowed bg-gray-200 text-gray-400" : added ? "bg-emerald-100 text-emerald-800" : "bg-emerald-700 text-white hover:bg-emerald-800"}`}
    >
      {disabled ? "Out of Stock" : added ? "✔ Added" : "Add to Cart"}
    </button>
  );
}
