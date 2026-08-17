"use client";

import { useState } from "react";

/** Parent Item picker: choose an existing parent, none, or add a new one. */
export function ParentItemField({ options, defaultValue }: { options: string[]; defaultValue?: string | null }) {
  const initial = defaultValue && options.includes(defaultValue) ? defaultValue : defaultValue ? "__new__" : "";
  const [choice, setChoice] = useState(initial);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        className="input w-52"
        name={choice === "__new__" ? undefined : "parentItem"}
      >
        <option value="">— none (standalone) —</option>
        {options.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
        <option value="__new__">➕ Add new parent…</option>
      </select>
      {choice === "__new__" && (
        <input
          name="parentItem"
          defaultValue={defaultValue && !options.includes(defaultValue) ? defaultValue : ""}
          placeholder="New parent name, e.g. FungiStop 50 SC"
          required
          className="input w-56"
          autoFocus
        />
      )}
    </div>
  );
}
