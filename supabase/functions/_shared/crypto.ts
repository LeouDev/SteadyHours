// AES-256-GCM for the Harvest token while an import runs. Key: IMPORT_TOKEN_KEY (base64, 32 bytes).

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

export function importKey(base64Key: string): Promise<CryptoKey> {
  const raw = unb64(base64Key)
  if (raw.length !== 32) throw new Error('IMPORT_TOKEN_KEY must be 32 bytes, base64-encoded')
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptToken(key: CryptoKey, token: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(token)))
  return `${b64(iv)}.${b64(ct)}`
}

export async function decryptToken(key: CryptoKey, stored: string): Promise<string> {
  const [iv, ct] = stored.split('.')
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, key, unb64(ct))
  return new TextDecoder().decode(pt)
}
