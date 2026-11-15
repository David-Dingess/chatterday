import type { Attachment } from './types';

export async function api<T = any>(path: string, body?: unknown, method?: string): Promise<T> {
  const r = await fetch('/api' + path, {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || r.statusText), { status: r.status });
  return j as T;
}

export async function upload(file: Blob, kind: 'attachment' | 'avatar' | 'sound' | 'photo', name?: string) {
  const n = name ?? (file as File).name ?? 'file';
  const r = await fetch(`/api/upload?kind=${kind}&name=${encodeURIComponent(n)}`, {
    method: 'POST', body: file, headers: { 'Content-Type': 'application/octet-stream' },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Upload failed.');
  return j as Extract<Attachment, { kind: 'file' }>;
}
