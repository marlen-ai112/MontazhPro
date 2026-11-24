import type { AppState } from '../types';
import { isAppState, sanitize } from '../lib/state';
import type { Repository } from './types';

const KEY = 'odq:state:v1';
const BACKUP_KEY = 'odq:state:corrupt-backup';

export class LocalRepository implements Repository {
  readonly kind = 'local' as const;
  /** Если прошлые данные были повреждены — сюда попадает пояснение для уведомления */
  recovered = false;

  constructor(private key: string = KEY) {}

  async load(): Promise<AppState | null> {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(this.key);
    } catch {
      throw new Error('Браузер запретил доступ к localStorage (приватный режим?). Данные не будут сохраняться.');
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

  async save(_prev: AppState | null, next: AppState): Promise<void> {
    try {
      localStorage.setItem(this.key, JSON.stringify(next));
    } catch {
      throw new Error('Не удалось сохранить данные: хранилище браузера недоступно или переполнено');
    }
  }
}
