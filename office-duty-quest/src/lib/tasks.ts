import type { TaskDef } from '../types';

export const TASKS: TaskDef[] = [
  { id: 'toilet', title: 'Порядок в туалете', hint: 'Чисто, пополнены расходники' },
  { id: 'kitchen', title: 'Порядок на кухне', hint: 'Столы протёрты, мусор вынесен' },
  { id: 'dishes', title: 'Мытьё посуды', hint: 'Раковина и посуда чистые' },
  { id: 'workplace', title: 'Порядок на рабочем месте', hint: 'Рабочая зона и общие столы' },
  { id: 'self', title: 'Контроль порядка за собой', hint: 'Своё место и общие зоны' },
];

export const TASK_IDS = TASKS.map((t) => t.id);
export const taskById = (id: string) => TASKS.find((t) => t.id === id);
