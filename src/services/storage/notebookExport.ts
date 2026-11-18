import {
  NotebookDocument,
  RawNotebookDocumentJson,
  normalizeNotebookDocument,
  serializeNotebookDocument,
} from '../../types/nbformat';

export function serializeNotebookToString(notebook: NotebookDocument): string {
  return JSON.stringify(serializeNotebookDocument(notebook), null, 2) + '\n';
}

export function getExportFileName(path: string): string {
  const base = path.split('/').pop() || 'apunte.ipynb';
  return base.endsWith('.ipynb') ? base : `${base}.ipynb`;
}

export function downloadNotebookFile(path: string, notebook: NotebookDocument): void {
  const fileName = getExportFileName(path);
  const content = serializeNotebookToString(notebook);
  const blob = new Blob([content], { type: 'application/x-ipynb+json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function shareNotebookFile(
  path: string,
  notebook: NotebookDocument
): Promise<'shared' | 'downloaded'> {
  const fileName = getExportFileName(path);
  const content = serializeNotebookToString(notebook);

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    const file = new File([content], fileName, { type: 'application/json' });
    const canShareFiles =
      typeof navigator.canShare !== 'function' || navigator.canShare({ files: [file] });

    if (canShareFiles) {
      await navigator.share({
        title: fileName.replace(/\.ipynb$/i, ''),
        files: [file],
      });
      return 'shared';
    }
  }

  downloadNotebookFile(path, notebook);
  return 'downloaded';
}

export function parseImportedNotebook(
  fileName: string,
  rawText: string
): { path: string; notebook: NotebookDocument } {
  let parsed: RawNotebookDocumentJson;
  try {
    parsed = JSON.parse(rawText) as RawNotebookDocumentJson;
  } catch {
    throw new Error('El archivo seleccionado no es JSON válido.');
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.cells)) {
    throw new Error('El archivo no tiene el formato nbformat v4 (.ipynb) válido.');
  }

  const cleanName = (fileName.split('/').pop() || 'Importado')
    .replace(/\.ipynb$/i, '')
    .trim();
  const path = `${cleanName || 'Importado'}.ipynb`;

  return {
    path,
    notebook: normalizeNotebookDocument(parsed),
  };
}
