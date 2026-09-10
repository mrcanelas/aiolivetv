function legacyKey(key: string): string {
  return key.replace(/^aiolivetv/, 'aiostreams');
}

export function readLocalStorage(key: string): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(key) ?? localStorage.getItem(legacyKey(key));
}

export function writeLocalStorage(key: string, value: string): void {
  localStorage.setItem(key, value);
}
