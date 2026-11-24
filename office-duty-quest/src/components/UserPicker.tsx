import { UserCheck } from 'lucide-react';
import { useApp } from '../store/AppContext';
import { Avatar } from './Avatar';
import { Modal } from './Modal';

export function UserPicker({ onClose }: { onClose: () => void }) {
  const { state, currentEmployeeId, setCurrentEmployee, toast } = useApp();
  return (
    <Modal title="Кто вы?" onClose={onClose}>
      <p className="mb-3 text-sm text-slate-400">Выберите своё имя — вы сможете отмечать задания в свой день дежурства.</p>
      <div className="grid gap-2">
        {state.employees.map((e) => (
          <button key={e.id} onClick={() => { setCurrentEmployee(e.id); toast('success', `Вы вошли как ${e.name}`); onClose(); }}
            className={`flex min-h-[52px] items-center gap-3 rounded-xl border px-3 py-2 text-left transition ${currentEmployeeId === e.id ? 'border-volt/60 bg-volt/10' : 'border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.07]'}`}>
            <Avatar name={e.name} id={e.id} size={36} />
            <span className="flex-1 font-semibold text-white">{e.name}</span>
            {currentEmployeeId === e.id && <UserCheck size={18} className="text-volt-400" />}
          </button>
        ))}
        {currentEmployeeId && (
          <button className="btn-ghost mt-1" onClick={() => { setCurrentEmployee(null); onClose(); }}>Выйти (режим просмотра)</button>
        )}
      </div>
    </Modal>
  );
}
