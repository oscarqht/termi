export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function formatImageName(file: File, index = 0): string {
  const ext = file.type.split('/')[1] || 'png';
  const cleanExt = ext === 'jpeg' ? 'jpg' : ext;
  if (file.name && file.name !== 'image.png' && file.name !== 'blob' && !file.name.startsWith('image.')) {
    return file.name;
  }
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const suffix = index > 0 ? `-${index + 1}` : '';
  return `pasted-image-${timestamp}${suffix}.${cleanExt}`;
}

export async function uploadSessionFiles(sessionId: string, files: File[]): Promise<string[]> {
  const paths: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const name = formatImageName(file, i);
    const res = await fetch(
      `/api/sessions/${sessionId}/upload?name=${encodeURIComponent(name)}`,
      { method: 'POST', body: file },
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error ?? `Failed to upload ${name}`);
    }
    const data = await res.json();
    paths.push(data.path as string);
  }
  return paths;
}
