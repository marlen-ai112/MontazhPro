import type { AppState } from '../types';

/**
 * Единый интерфейс хранилища. Локальный режим (localStorage) и облачный (Supabase)
 * реализуют его одинаково, поэтому остальной код приложения о режиме не знает.
 */
export interface Repository {
  readonly kind: 'local' | 'supabase';
  /** Возвращает сохранённое состояние или null, если данных ещё нет */
  load(): Promise<AppState | null>;
  /** Сохраняет изменения. prev — состояние до изменения (для вычисления разницы) */
  save(prev: AppState | null, next: AppState): Promise<void>;
}
