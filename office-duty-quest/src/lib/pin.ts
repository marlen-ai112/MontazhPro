/** Хэширование PIN-кода. SHA-256 через WebCrypto, с запасным вариантом для небезопасного контекста. */
export async function hashPin(pin: string): Promise<string> {
  const data = `odq:${pin}`;
  try {
    if (globalThis.crypto?.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
      return 'sha256:' + Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    /* падаем в запасной вариант */
  }
  return 'fnv:' + fnv(data);
}

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  if (hash.startsWith('fnv:')) return 'fnv:' + fnv(`odq:${pin}`) === hash;
  return (await hashPin(pin)) === hash;
}

export const DEFAULT_PIN = '1234';
export const isValidPin = (p: string) => /^\d{4,8}$/.test(p);
