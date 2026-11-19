export function ensureMarkdownExtension(rawName: string): string {
  const cleaned = rawName.trim().replace(/^\/+|\/+$/g, '');
  if (!cleaned) return 'nota-tecnica.md';
  return /\.md$/i.test(cleaned) ? cleaned : `${cleaned}.md`;
}

export function getReactiveDocBaseName(path: string): string {
  const base = path.split('/').pop() || 'nota-tecnica.md';
  return ensureMarkdownExtension(base);
}

export function downloadReactiveMarkdown(path: string, content: string): void {
  const fileName = getReactiveDocBaseName(path);
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function shareReactiveMarkdown(
  path: string,
  content: string
): Promise<'shared' | 'downloaded'> {
  const fileName = getReactiveDocBaseName(path);

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    const file = new File([content], fileName, { type: 'text/markdown' });
    const canShareFiles =
      typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] });

    if (canShareFiles) {
      await navigator.share({
        title: fileName.replace(/\.md$/i, ''),
        files: [file],
      });
      return 'shared';
    }
  }

  downloadReactiveMarkdown(path, content);
  return 'downloaded';
}

export async function readImportedMarkdownFile(
  file: File
): Promise<{ path: string; content: string }> {
  const content = await file.text();
  const path = ensureMarkdownExtension(file.name || 'nota-importada.md');
  return { path, content };
}
