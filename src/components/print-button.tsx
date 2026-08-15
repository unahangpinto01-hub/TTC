"use client";

import { useRouter } from "next/navigation";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="btn-primary">
      🖨 Print / Save as PDF
    </button>
  );
}

export function BackButton() {
  const router = useRouter();
  return (
    <button type="button" onClick={() => router.back()} className="btn-secondary">
      ← Back
    </button>
  );
}
