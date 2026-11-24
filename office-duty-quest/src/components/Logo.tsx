import { useId } from 'react';

export function Logo({ size = 40 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4f8cff" />
          <stop offset="1" stopColor="#8b5cf6" />
        </linearGradient>
      </defs>
      <path d="M32 6l20 8v16c0 13-8.5 23-20 28C20.500 53 12 43 12 30V14z" fill={`url(#${id})`} />
      <path d="M22 31l7.500 7.500L43 23" fill="none" stroke="#f5c451" strokeWidth="5.500" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
