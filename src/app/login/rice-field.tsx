/** Stylized rice-field backdrop: terraced paddies, mountains, sun, and a farmer planting seedlings. */
export function RiceFieldBackground() {
  return (
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 1200 800"
      preserveAspectRatio="xMidYMax slice"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#0c4a3e" />
          <stop offset="45%" stopColor="#136c52" />
          <stop offset="100%" stopColor="#1d9d6f" />
        </linearGradient>
        <linearGradient id="paddy1" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#34d399" />
          <stop offset="100%" stopColor="#059669" />
        </linearGradient>
        <linearGradient id="paddy2" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6ee7b7" />
          <stop offset="100%" stopColor="#10b981" />
        </linearGradient>
        <linearGradient id="water" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#99f6e4" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#14b8a6" stopOpacity="0.35" />
        </linearGradient>
      </defs>

      <rect width="1200" height="800" fill="url(#sky)" />

      {/* sun */}
      <circle cx="950" cy="150" r="70" fill="#fcd34d" opacity="0.9" />
      <circle cx="950" cy="150" r="100" fill="#fcd34d" opacity="0.25" />

      {/* mountains */}
      <path d="M0 330 L180 190 L340 320 L520 170 L720 330 Z" fill="#0b3d33" opacity="0.9" />
      <path d="M520 330 L750 210 L980 330 L1200 240 L1200 360 L0 360 Z" fill="#0e5241" opacity="0.85" />

      {/* terraced paddies */}
      <path d="M0 360 Q600 330 1200 360 L1200 470 Q600 440 0 470 Z" fill="url(#paddy2)" />
      <path d="M0 470 Q600 440 1200 470 L1200 600 Q600 570 0 600 Z" fill="url(#paddy1)" />
      <path d="M0 600 Q600 570 1200 600 L1200 800 L0 800 Z" fill="url(#water)" />
      <path d="M0 600 Q600 570 1200 600 L1200 800 L0 800 Z" fill="#047857" opacity="0.35" />

      {/* terrace edge lines */}
      <path d="M0 470 Q600 440 1200 470" stroke="#065f46" strokeWidth="4" fill="none" opacity="0.6" />
      <path d="M0 600 Q600 570 1200 600" stroke="#065f46" strokeWidth="4" fill="none" opacity="0.6" />

      {/* planted seedling rows in the foreground paddy */}
      {Array.from({ length: 5 }).map((_, row) =>
        Array.from({ length: 16 }).map((_, col) => {
          const x = 40 + col * 78 + (row % 2) * 39;
          const y = 640 + row * 34;
          return (
            <g key={`${row}-${col}`} opacity="0.85">
              <path d={`M${x} ${y} l-7 -18 M${x} ${y} l0 -22 M${x} ${y} l7 -18`} stroke="#a7f3d0" strokeWidth="3" strokeLinecap="round" fill="none" />
              <ellipse cx={x} cy={y + 3} rx="10" ry="2.5" fill="#022c22" opacity="0.3" />
            </g>
          );
        })
      )}

      {/* mid-field seedling texture */}
      {Array.from({ length: 3 }).map((_, row) =>
        Array.from({ length: 22 }).map((_, col) => {
          const x = 20 + col * 56 + (row % 2) * 28;
          const y = 500 + row * 30;
          return (
            <path key={`m${row}-${col}`} d={`M${x} ${y} l-4 -10 M${x} ${y} l0 -12 M${x} ${y} l4 -10`} stroke="#065f46" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.5" />
          );
        })
      )}

      {/* farmer planting rice (bent over, straw hat, seedling bundle) */}
      <g transform="translate(690 610)">
        <ellipse cx="10" cy="82" rx="55" ry="7" fill="#022c22" opacity="0.35" />
        {/* legs in water */}
        <path d="M-8 40 L-12 72 M26 42 L30 70" stroke="#1e293b" strokeWidth="10" strokeLinecap="round" />
        {/* body bent forward */}
        <path d="M-14 42 Q6 8 52 26" stroke="#166534" strokeWidth="18" strokeLinecap="round" fill="none" />
        {/* reaching arm planting */}
        <path d="M42 28 Q58 48 66 64" stroke="#166534" strokeWidth="8" strokeLinecap="round" fill="none" />
        {/* arm holding seedlings */}
        <path d="M2 26 Q-8 44 -4 56" stroke="#166534" strokeWidth="8" strokeLinecap="round" fill="none" />
        {/* seedling bundle in hand */}
        <path d="M-6 54 l-6 -14 M-4 54 l0 -17 M-2 54 l6 -14 M-5 54 l-10 -10 M-3 54 l10 -10" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        {/* seedling being planted */}
        <path d="M66 66 l-5 -12 M67 66 l0 -14 M68 66 l5 -12" stroke="#4ade80" strokeWidth="2.5" strokeLinecap="round" fill="none" />
        {/* head + straw hat */}
        <circle cx="56" cy="18" r="9" fill="#a16207" />
        <path d="M36 12 Q56 -8 78 14 Q66 8 56 8 Q46 8 36 12 Z" fill="#eab308" />
        <ellipse cx="57" cy="12" rx="21" ry="5" fill="#facc15" />
        {/* reflection */}
        <path d="M-14 78 Q10 84 40 78" stroke="#99f6e4" strokeWidth="3" opacity="0.4" fill="none" />
      </g>

      {/* second distant farmer */}
      <g transform="translate(380 520) scale(0.45)" opacity="0.75">
        <path d="M-8 40 L-12 72 M26 42 L30 70" stroke="#1e293b" strokeWidth="10" strokeLinecap="round" />
        <path d="M-14 42 Q6 8 52 26" stroke="#14532d" strokeWidth="18" strokeLinecap="round" fill="none" />
        <path d="M42 28 Q58 48 66 64" stroke="#14532d" strokeWidth="8" strokeLinecap="round" fill="none" />
        <circle cx="56" cy="18" r="9" fill="#a16207" />
        <path d="M36 12 Q56 -8 78 14 Q66 8 56 8 Q46 8 36 12 Z" fill="#eab308" />
      </g>

      {/* birds */}
      <path d="M200 120 q10 -10 20 0 q10 -10 20 0" stroke="#d1fae5" strokeWidth="3" fill="none" strokeLinecap="round" opacity="0.7" />
      <path d="M290 90 q8 -8 16 0 q8 -8 16 0" stroke="#d1fae5" strokeWidth="2.5" fill="none" strokeLinecap="round" opacity="0.6" />
    </svg>
  );
}
