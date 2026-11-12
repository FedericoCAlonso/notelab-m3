# NoteLab M3

**NoteLab M3** es una Progressive Web App (PWA) liviana y ultrarrápida diseñada con **Material Design 3 (M3)** como cliente frontal para **Jupyter Server en Termux (Android)**, optimizada específicamente para **tomar apuntes técnicos en clase en pantalla completa con un teléfono Android y teclado físico externo**.

---

## Características principales

- **Layout Zen de columna única (`100vw`):** sin barras laterales fijas ni menús densos; *Top App Bar* compacta con `hide-on-scroll`, *M3 Modal Navigation Drawer*, *M3 Assist Chip* para el estado del Kernel Python y *Status Badge* de sincronización.
- **Renderizado científico 100% offline:** Markdown + tablas GFM + ecuaciones **KaTeX** (`$...$` / `$$...$$` con scroll horizontal suave) + bloques monoespaciados estrictos (`JetBrains Mono`, `white-space: pre`, `overflow-x: auto`) para diagramas ASCII sin roturas.
- **Edición ágil con CodeMirror 6:** autoajustable en altura, resaltado de Markdown y Python, y atajos integrados para teclado físico en Android.
- **Arquitectura Local-First con Outbox Sync (`IndexedDB`):** ninguna escritura depende de la red. Si Android suspende Termux en segundo plano, los apuntes quedan en IndexedDB (`pendingSync: true`) y se sincronizan automáticamente mediante reintentos exponenciales o al recuperar foco (`visibilitychange` / `online`).
- **Motor Python en vivo (`nbformat v4`):** ejecución ordenada vía WebSocket (`shell` / `iopub`) con soporte para `stdout`/`stderr`, gráficos `image/png` y `image/svg+xml`, tablas HTML, trazas de error limpias y modo *Progressive Output Disclosure* (`Ctrl + H`).

---

## Atajos de teclado (optimizados para Android)

> Chrome en Android intercepta `Esc` como botón Atrás, por lo que **nunca se depende exclusivamente de `Esc`** para salir de edición.

| Atajo | Acción |
| :--- | :--- |
| `Enter` (modo lectura) | Entrar en modo edición en la celda activa |
| `Ctrl + Enter` | Renderizar Markdown / ejecutar Python y volver a lectura |
| `Shift + Enter` | Renderizar/ejecutar celda y pasar (o crear) la siguiente |
| `Alt + ↑` / `Alt + ↓` (o `↑`/`↓` en lectura) | Navegar entre celdas |
| `Ctrl + B` | Insertar nueva celda debajo |
| `Ctrl + M` | Alternar tipo de celda (`markdown` ↔ `code`) |
| `Ctrl + H` | Ocultar/mostrar código fuente Python (*Progressive Output Disclosure*) |
| `Ctrl + S` | Forzar sincronización inmediata con Jupyter Server |
| `Ctrl + /` | Abrir guía rápida de atajos y configuración de Termux |

---

## Configuración de Jupyter Server en Termux (Android)

1. Instala Jupyter dentro de Termux:
   ```bash
   pkg update && pkg install python
   pip install jupyterlab ipykernel
   ```

2. Ejecuta el script incluido en este repositorio [`scripts/configure_jupyter_termux.sh`](scripts/configure_jupyter_termux.sh) pasando el origen de tu PWA en GitHub Pages:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/FedericoCAlonso/notelab-m3/main/scripts/configure_jupyter_termux.sh | bash -s -- "https://FedericoCAlonso.github.io"
   ```
   *(O si clonaste el repo localmente: `bash scripts/configure_jupyter_termux.sh https://FedericoCAlonso.github.io`)*

   Este script configura `~/.jupyter/jupyter_server_config.py` y `~/.jupyter/jupyter_notebook_config.py` con:
   ```python
   c.ServerApp.allow_origin = 'https://FedericoCAlonso.github.io'
   c.ServerApp.allow_credentials = True
   c.ServerApp.disable_check_xsrf = True
   c.ServerApp.ip = '127.0.0.1'
   c.ServerApp.port = 8888
   ```

3. Inicia Jupyter en Termux:
   ```bash
   jupyter server --no-browser
   ```
   Copia el `token=...` mostrado en consola y pégalo en el diálogo **Conexión Termux / Token** dentro de NoteLab M3.

---

## Arquitectura en `src/`

- `src/types/nbformat.ts` — Modelo estricto `nbformat v4` y normalización/serialización compatible con JupyterLab, VS Code y Colab.
- `src/services/jupyter/JupyterGateway.ts` — *Adapter / Gateway Pattern* sobre `/api/contents` y `/api/kernels` + WebSocket (`shell` / `iopub`).
- `src/services/storage/NotebookDB.ts` — Almacenamiento persistente en IndexedDB (`idb`) para notebooks, cola Outbox y configuración.
- `src/services/sync/SyncEngine.ts` — Motor *Local-First* con debounce (800ms), reintentos exponenciales y re-sincronización al recuperar conectividad/foco.
- `src/state/machines.ts` — *Finite State Machines* para Celdas (`VIEWING | EDITING | QUEUED | RUNNING | ERROR`), Kernel (`DISCONNECTED | CONNECTING | IDLE | BUSY | DEAD`) y cola FIFO de ejecución.
- `src/commands/CommandRegistry.ts` — *Command Pattern* y registro centralizado de atajos desacoplado de la UI.

---

## Desarrollo local y pruebas

```bash
npm install
npm test
npm run build
```
