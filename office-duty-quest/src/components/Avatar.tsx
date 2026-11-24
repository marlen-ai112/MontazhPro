const PALETTES = [
  ['#4f8cff', '#8b5cf6'], ['#8b5cf6', '#ec4899'], ['#06b6d4', '#4f8cff'], ['#f5c451', '#f97316'],
  ['#34d399', '#06b6d4'], ['#f472b6', '#8b5cf6'], ['#60a5fa', '#34d399'],
];

function hash(s: string) { let h = 0; for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return h; }

export function Avatar({ name, id, size = 40, ring }: { name: string; id: string; size?: number; ring?: 'gold' | 'blue' | 'violet' }) {
  const [a, b] = PALETTES[hash(id) % PALETTES.length];
  const ringCls = ring === 'gold' ? 'ring-2 ring-gold/80' : ring === 'violet' ? 'ring-2 ring-royal/80' : ring === 'blue' ? 'ring-2 ring-volt/80' : '';
  return (
    <div
      className={`grid shrink-0 place-items-center rounded-xl font-display font-bold text-white shadow-inner ${ringCls}`}
      style={{ width: size, height: size, background: `linear-gradient(135deg, ${a}, ${b})`, fontSize: size * 0.42 }}
      aria-hidden
    >
      {name.trim().charAt(0).toUpperCase() || '?'}
    </div>
  );
}
