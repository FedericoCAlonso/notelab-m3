import { describe, expect, it } from 'vitest';
import {
  getExportFileName,
  parseImportedNotebook,
  serializeNotebookToString,
} from '../services/storage/notebookExport';
import {
  createMarkdownCell,
  normalizeNotebookDocument,
  serializeNotebookDocument,
} from '../types/nbformat';
import { resolveAttachmentUrl } from '../components/MarkdownRenderer';

describe('Notebook Export / Import & Attachments', () => {
  it('round-trips nbformat v4 notebooks with markdown attachments', () => {
    const md = createMarkdownCell('![pizarron](attachment:pizarron.png)');
    md.attachments = {
      'pizarron.png': {
        'image/png': 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB',
      },
    };

    const doc = {
      nbformat: 4 as const,
      nbformat_minor: 5,
      metadata: {},
      cells: [md],
    };

    const json = serializeNotebookToString(doc);
    const imported = parseImportedNotebook('Clase_5.ipynb', json);
    expect(imported.path).toBe('Clase_5.ipynb');
    expect(imported.notebook.cells[0]?.cell_type).toBe('markdown');
    if (imported.notebook.cells[0]?.cell_type === 'markdown') {
      expect(imported.notebook.cells[0].attachments?.['pizarron.png']?.['image/png']).toBe(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB'
      );
    }

    const normalized = normalizeNotebookDocument(serializeNotebookDocument(doc));
    expect(normalized.cells[0]?.cell_type).toBe('markdown');
  });

  it('rejects malformed or non-notebook files on import', () => {
    expect(() => parseImportedNotebook('bad.ipynb', '{not json')).toThrow(/JSON válido/);
    expect(() => parseImportedNotebook('bad.ipynb', '{"hello": 1}')).toThrow(/nbformat v4/);
  });

  it('normalizes export file names and resolves attachment URLs', () => {
    expect(getExportFileName('apuntes/Calculo')).toBe('Calculo.ipynb');
    expect(getExportFileName('Algebra.ipynb')).toBe('Algebra.ipynb');

    const attachments = {
      'foto.jpg': {
        'image/jpeg': '/9j/4AAQSkZJRg==',
      },
    };
    expect(resolveAttachmentUrl('attachment:foto.jpg', attachments)).toBe(
      'data:image/jpeg;base64,/9j/4AAQSkZJRg=='
    );
    expect(resolveAttachmentUrl('https://example.com/a.png', attachments)).toBe(
      'https://example.com/a.png'
    );
  });
});
