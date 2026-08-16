"use client";

import { useEffect, useState } from "react";

/** Live date + time in Manila time; renders after mount to avoid hydration mismatch. */
export function Clock() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  if (!now) return <span className="text-sm text-gray-500">&nbsp;</span>;

  const date = now.toLocaleDateString("en-PH", {
    timeZone: "Asia/Manila",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const time = now.toLocaleTimeString("en-PH", {
    timeZone: "Asia/Manila",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  return (
    <span className="text-sm text-gray-500">
      {date} · <span className="font-semibold tabular-nums text-gray-700">{time}</span>
    </span>
  );
}
