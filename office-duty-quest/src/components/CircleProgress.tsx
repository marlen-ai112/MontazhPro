import { useId, type ReactNode } from 'react';

interface Props {
  value: number; // 0..100
  size?: number;
  stroke?: number;
  children?: ReactNode;
  done?: boolean;
}

export function CircleProgress({ value, size = 200, stroke = 14, children, done }: Props) {
  const id = useId();
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, value));
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }} role="img" aria-label={`Выполнено ${Math.round(v)}%`}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            {done ? (<><stop offset="0" stopColor="#f5c451" /><stop offset="1" stopColor="#34d399" /></>) : (<><stop offset="0" stopColor="#4f8cff" /><stop offset="1" stopColor="#8b5cf6" /></>)}
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,.07)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none" stroke={`url(#${id})`} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)}
          style={{ transition: 'stroke-dashoffset .8s cubic-bezier(.3,.8,.3,1)', filter: `drop-shadow(0 0 8px ${done ? 'rgba(245,196,81,.55)' : 'rgba(99,120,255,.55)'})` }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">{children}</div>
    </div>
  );
}
