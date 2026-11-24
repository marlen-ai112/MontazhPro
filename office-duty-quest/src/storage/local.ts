import type { AppState } from '../types';
import { isAppState, sanitize } from '../lib/state';
import type { Repository } from './types';

const KEY = 'odq:state:v1';
const BACKUP_KEY = 'odq:state:corrupt-backup';

export class LocalRepository implements Repository {
  readonly kind = 'local' as const;
  /** Если прошлые данные были повреждены — сюда попадает пояснение для уведомления */
  recovered = false;
  /** Хранилище браузера недоступно — данные держим в памяти до закрытия страницы */
  degraded = false;
  private memory: string | null = null;

  constructor(private key: string = KEY) {}

  async load(): Promise<AppState | null> {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(this.key);
    } catch {
      this.degraded = true;
      return null;
    }
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!isAppState(parsed)) throw new Error('bad shape');
      return sanitize(parsed);
    } catch {
      // сохраняем повреждённую копию, чтобы ничего не потерять безвозвратно
      try { localStorage.setItem(BACKUP_KEY, raw); } catch { /* ignore */ }
      this.recovered = true;
      return null;
    }
  }

  /** Копия данных в памяти (только в деградированном режиме) */
  get memoryCopy() { return this.memory; }

  async save(_prev: AppState | null, next: AppState): Promise<void> {
    if (this.degraded) { this.memory = JSON.stringify(next); return; }
    try {
      localStorage.setItem(this.key, JSON.stringify(next));
    } catch {
      throw new Error('Не удалось сохранить данные: хранилище браузера недоступно или переполнено');
    }
  }
}
