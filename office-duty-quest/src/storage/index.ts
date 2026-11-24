import { LocalRepository } from './local';
import { SupabaseRepository } from './supabase';
import type { Repository } from './types';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const cloudConfigured = Boolean(url && key);

/** Основное хранилище: Supabase, если задана конфигурация, иначе localStorage */
export function createRepository(): Repository {
  return cloudConfigured ? new SupabaseRepository(url!, key!) : new LocalRepository();
}

/** Локальная копия — резерв и кэш (в облачном режиме тоже пишется) */
export const localMirror = new LocalRepository('odq:state:v1');

export type { Repository };
