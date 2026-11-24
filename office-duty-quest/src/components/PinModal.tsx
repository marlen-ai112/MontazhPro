import { useEffect, useRef, useState } from 'react';
import { Delete, Lock } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { Modal } from './Modal';

export function PinModal({ onClose, onSuccess }: { onClose: () => void; onSuccess?: () => void }) {
  const { loginAdmin } = useApp();
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const attempts = useRef(0);
  const lockedUntil = useRef(0);
  const pinRef = useRef('');
  pinRef.current = pin;

  const submit = async (value: string) => {
    if (Date.now() < lockedUntil.current) {
      setError(`Слишком много попыток. Подождите ${Math.ceil((lockedUntil.current - Date.now()) / 1000)} с`);
      setPin('');
      return;
    }
    setBusy(true);
    const ok = await loginAdmin(value);
    setBusy(false);
    if (ok) { onClose(); onSuccess?.(); return; }
    attempts.current += 1;
    if (attempts.current >= 5) { lockedUntil.current = Date.now() + 30000; attempts.current = 0; setError('Слишком много попыток. Подождите 30 с'); }
    else setError('Неверный PIN-код');
    setPin('');
  };

  const press = (d: string) => {
    if (busy) return;
    setError('');
    setPin((p) => (p + d).slice(0, 8));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') setPin((p) => p.slice(0, -1));
      else if (e.key === 'Enter' && pinRef.current.length >= 4) void submit(pinRef.current);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  return (
    <Modal title="Режим администратора" onClose={onClose}>
      <div className="text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-volt/30 to-royal/30 text-volt-400"><Lock size={26} /></div>
        <p className="mt-3 text-sm text-slate-400">Введите PIN-код (4–8 цифр)</p>
        <div className="my-5 flex justify-center gap-2.5" aria-live="polite" data-testid="pin-dots">
          {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
            <span key={i} className={`h-3.5 w-3.5 rounded-full border transition ${i < pin.length ? 'border-volt bg-volt shadow-[0_0_10px_rgba(79,140,255,.8)]' : 'border-white/20'}`} />
          ))}
        </div>
        <p className={`h-5 text-sm ${error ? 'text-bad' : 'text-transparent'}`}>{error || '.'}</p>
        <div className="mx-auto mt-2 grid max-w-[260px] grid-cols-3 gap-2.5">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button key={d} className="btn-ghost h-14 text-xl" onClick={() => press(d)}>{d}</button>
          ))}
          <button className="btn-ghost h-14" onClick={() => setPin((p) => p.slice(0, -1))} aria-label="Стереть"><Delete size={20} /></button>
          <button className="btn-ghost h-14 text-xl" onClick={() => press('0')}>0</button>
          <button className="btn-primary h-14" disabled={pin.length < 4 || busy} onClick={() => void submit(pin)}>OK</button>
        </div>
      </div>
    </Modal>
  );
}
