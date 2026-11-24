import { useMemo } from 'react';
import { CheckCircle2, Info, Sparkles, Trophy, X, XCircle } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { levelFor, xpFor } from '../lib/game';
import { employeeById } from '../lib/state';
import { formatLong } from '../lib/dates';
import { Avatar } from './Avatar';
import { Modal } from './Modal';

const COLORS = ['#4f8cff', '#8b5cf6', '#f5c451', '#34d399', '#ffffff', '#f472b6'];

export function Confetti({ count = 70 }: { count?: number }) {
  const pieces = useMemo(() => Array.from({ length: count }, (_, i) => {
    const ang = Math.random() * Math.PI * 2;
    const dist = 120 + Math.random() * 320;
    return {
      i,
      dx: Math.cos(ang) * dist, dy: Math.sin(ang) * dist - 80 + Math.random() * 260,
      rot: (Math.random() * 900 - 450) + 'deg', dur: 1.3 + Math.random() * 1.4 + 's',
      color: COLORS[i % COLORS.length], w: 5 + Math.random() * 6, h: 8 + Math.random() * 8,
    };
  }), [count]);
  return (
    <div className="pointer-events-none absolute left-1/2 top-1/3 h-0 w-0" aria-hidden>
      {pieces.map((p) => (
        <span key={p.i} className="absolute animate-confetti rounded-[2px]"
          style={{ ['--dx' as string]: p.dx + 'px', ['--dy' as string]: p.dy + 'px', ['--rot' as string]: p.rot, ['--dur' as string]: p.dur, background: p.color, width: p.w, height: p.h }} />
      ))}
    </div>
  );
}

export function FxLayer() {
  const { toasts, dismissToast, floats, victory, closeVictory, state, today, openTasks } = useApp();
  const vEmp = victory ? employeeById(state, victory.employeeId) : null;
  return (
    <>
      {/* всплывающие +XP */}
      <div className="pointer-events-none fixed inset-0 z-[60] overflow-hidden" aria-hidden>
        {floats.map((f) => (
          <div key={f.id} className={`absolute -translate-x-1/2 animate-floatUp font-display text-xl font-extrabold ${f.gold ? 'text-gold drop-shadow-[0_0_12px_rgba(245,196,81,.9)]' : 'text-volt-400 drop-shadow-[0_0_10px_rgba(79,140,255,.9)]'}`} style={{ left: f.x, top: f.y }}>
            {f.text}
          </div>
        ))}
      </div>

      {/* уведомления */}
      <div className="pointer-events-none fixed inset-x-0 top-0 z-[70] flex flex-col items-center gap-2 px-3 pt-[max(env(safe-area-inset-top),12px)]" role="status" aria-live="polite">
        {toasts.map((t) => {
          const Icon = t.kind === 'success' ? CheckCircle2 : t.kind === 'error' ? XCircle : t.kind === 'xp' ? Sparkles : Info;
          const tone = t.kind === 'success' ? 'text-ok' : t.kind === 'error' ? 'text-bad' : t.kind === 'xp' ? 'text-gold' : 'text-volt-400';
          return (
            <div key={t.id} className="card pointer-events-auto flex w-full max-w-sm animate-slideUp items-start gap-3 bg-ink-800 px-4 py-3 shadow-2xl">
              <Icon size={20} className={`mt-0.5 shrink-0 ${tone}`} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white">{t.text}</p>
                {t.sub && <p className="mt-0.5 break-words text-xs text-slate-400">{t.sub}</p>}
              </div>
              <button className="text-slate-500 hover:text-white" onClick={() => dismissToast(t.id)} aria-label="Закрыть уведомление"><X size={16} /></button>
            </div>
          );
        })}
      </div>

      {/* экран победы */}
      {victory && vEmp && (
        <Modal onClose={closeVictory} title="">
          <div className="relative -mt-10 pb-1 text-center" data-testid="victory">
            <Confetti />
            <div className="mx-auto grid h-24 w-24 animate-pop place-items-center rounded-3xl bg-gradient-to-br from-gold-400 to-gold-600 shadow-gold">
              <Trophy size={52} className="text-ink-950" />
            </div>
            <p className="label mt-5 text-gold">Победа</p>
            <h2 className="h-display mt-1 text-3xl">Дежурство завершено!</h2>
            <p className="mt-2 text-sm text-slate-400">{formatLong(victory.date)}</p>
            <div className="mx-auto mt-5 flex w-fit items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-4 py-3">
              <Avatar name={vEmp.name} id={vEmp.id} size={44} ring="gold" />
              <div className="text-left">
                <p className="font-display text-lg font-bold text-white">{vEmp.name}</p>
                <p className="text-xs text-slate-400">{levelFor(xpFor(state, vEmp.id)).name} · {xpFor(state, vEmp.id)} XP</p>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-white/[0.04] p-3"><p className="font-display text-xl font-bold text-volt-400">+100</p><p className="label mt-1">5 заданий</p></div>
              <div className="rounded-xl bg-white/[0.04] p-3"><p className="font-display text-xl font-bold text-gold">+50</p><p className="label mt-1">бонус</p></div>
              <div className="rounded-xl bg-gradient-to-br from-royal/30 to-volt/20 p-3"><p className="font-display text-xl font-bold text-white">{victory.xp}</p><p className="label mt-1">всего XP</p></div>
            </div>
            {victory.levelUp && (
              <p className="mt-4 animate-pop rounded-xl border border-gold/30 bg-gold/10 px-3 py-2 text-sm font-semibold text-gold">
                <Sparkles size={14} className="mr-1 inline" /> Новый уровень: {victory.levelUp}
              </p>
            )}
            <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
              <button className="btn-gold" onClick={closeVictory}>Отлично!</button>
              {victory.date !== today && <button className="btn-ghost" onClick={() => { closeVictory(); openTasks(victory.date); }}>К заданиям</button>}
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
