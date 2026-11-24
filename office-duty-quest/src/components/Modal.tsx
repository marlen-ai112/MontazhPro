import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export function Modal({ title, onClose, children, wide }: { title?: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm animate-fadeIn sm:items-center sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} className={`card max-h-[92vh] w-full overflow-y-auto rounded-b-none p-5 animate-slideUp sm:rounded-b-2xl ${wide ? 'sm:max-w-2xl' : 'sm:max-w-md'}`}>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="h-display text-lg">{title}</h2>
          <button className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-white/10 hover:text-white" onClick={onClose} aria-label="Закрыть"><X size={18} /></button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({ title, text, confirmLabel, danger, onConfirm, onCancel }: {
  title: string; text: ReactNode; confirmLabel: string; danger?: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <Modal title={title} onClose={onCancel}>
      <p className="text-sm leading-relaxed text-slate-300">{text}</p>
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button className="btn-ghost" onClick={onCancel}>Отмена</button>
        <button className={danger ? 'btn-danger' : 'btn-primary'} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </Modal>
  );
}
