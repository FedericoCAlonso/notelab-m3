import { NotebookDocument, createCodeCell, createMarkdownCell } from '../types/nbformat';

export const DEFAULT_NOTEBOOK_PATH = 'Bienvenida_NoteLab_M3.ipynb';

export function createStarterNotebook(): NotebookDocument {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata: {
      kernelspec: {
        display_name: 'Python 3 (ipykernel)',
        language: 'python',
        name: 'python3',
      },
      language_info: {
        name: 'python',
        mimetype: 'text/x-python',
        file_extension: '.py',
      },
    },
    cells: [
      createMarkdownCell(
        `# Apuntes Técnicos — NoteLab M3

Bienvenido a **NoteLab M3**, optimizado para tomar apuntes en clase con teclado físico en Android y **Jupyter Server en Termux**.

- \`Enter\`: editar celda activa
- \`Ctrl + Enter\`: renderizar Markdown o ejecutar Python y volver a lectura
- \`Shift + Enter\`: ejecutar/renderizar y avanzar (o crear celda nueva)
- \`Ctrl + H\`: ocultar código Python dejando solo su resultado
- \`Ctrl + /\`: abrir guía rápida de atajos y configuración de Termux`
      ),
      createMarkdownCell(
        `## Ecuaciones KaTeX y Tablas GFM

La transformada de Fourier continua se define como:

$$
\\hat{f}(\\xi) = \\int_{-\\infty}^{\\infty} f(x)\\, e^{-2\\pi i x \\xi}\\, dx
$$

| Atajo | Acción | Modo |
| :--- | :--- | :--- |
| \`Alt + ↑ / ↓\` | Navegar entre celdas | Lectura / Edición |
| \`Ctrl + B\` | Insertar celda debajo | Cualquiera |
| \`Ctrl + M\` | Alternar Markdown / Python | Cualquiera |
| \`Ctrl + S\` | Sincronizar con Termux | Cualquiera |`
      ),
      createMarkdownCell(
        `## Esquemas ASCII Monoespaciados

Los bloques de código mantienen \`white-space: pre\` y scroll horizontal suave:

\`\`\`text
+-------------------+       HTTP/WS        +------------------------+
|  NoteLab M3 PWA   | <------------------> |  Jupyter Server (8888) |
|  IndexedDB Outbox |   localhost + CORS   |  Termux / Python 3     |
+-------------------+                      +------------------------+
\`\`\``
      ),
      createCodeCell(
        `# Prueba de Kernel Python (Ctrl + Enter para ejecutar)
import math, sys

print(f"Python {sys.version.split()[0]} listo en Termux!")
for n in range(1, 5):
    print(f"sqrt({n}) = {math.sqrt(n):.4f}")`
      ),
    ],
  };
}
