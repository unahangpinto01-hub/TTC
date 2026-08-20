"use client";

import { useState } from "react";

/** Logo picker: accepts PNG/JPG, resizes to 160x160 on a transparent canvas
    (aspect ratio preserved, centered) and previews before saving. */
export function LogoField({ currentLogo }: { currentLogo: string | null }) {
  const [preview, setPreview] = useState<string | null>(currentLogo);
  const [pending, setPending] = useState<string>(""); // new resized data URL awaiting save
  const [remove, setRemove] = useState(false);
  const [error, setError] = useState("");

  const onFile = (file: File | undefined) => {
    setError("");
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type)) {
      setError("Please choose a PNG or JPG image.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = 160;
        canvas.height = 160;
        const ctx = canvas.getContext("2d")!;
        // fit inside 160x160, centered, keeping the image's appearance
        const scale = Math.min(160 / img.width, 160 / img.height);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        ctx.drawImage(img, Math.round((160 - w) / 2), Math.round((160 - h) / 2), w, h);
        const dataUrl = canvas.toDataURL("image/png");
        setPending(dataUrl);
        setPreview(dataUrl);
        setRemove(false);
      };
      img.onerror = () => setError("Could not read that image file.");
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div>
      <label className="label">Company Logo</label>
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-[100px] w-[100px] items-center justify-center overflow-hidden rounded-xl border border-gray-200 bg-gray-50">
          {preview && !remove ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt="Company logo preview" className="h-full w-full object-contain" />
          ) : (
            <span className="text-xs text-gray-400">No logo</span>
          )}
        </div>
        <div className="space-y-2">
          <input
            type="file"
            accept="image/png,image/jpeg"
            onChange={(e) => onFile(e.target.files?.[0])}
            className="block text-sm text-gray-600 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-700 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-emerald-800"
          />
          <p className="text-xs text-gray-500">PNG or JPG · resized to 160 × 160 pixels automatically</p>
          {(preview || pending) && !remove && (
            <button
              type="button"
              onClick={() => { setRemove(true); setPending(""); setPreview(null); }}
              className="text-xs text-red-500 hover:underline"
            >
              Remove logo
            </button>
          )}
          {error && <p className="text-xs text-red-600">{error}</p>}
          {pending && <p className="text-xs text-emerald-700">New logo ready — click Save Company Details to apply.</p>}
        </div>
      </div>
      <input type="hidden" name="logoDataUrl" value={pending} />
      <input type="hidden" name="removeLogo" value={remove ? "1" : ""} />
    </div>
  );
}
