#!/usr/bin/env bash
set -euo pipefail

# Configura Jupyter Server / Notebook en Termux (Android) para permitir
# peticiones CORS y WebSockets desde la PWA NoteLab M3 alojada en GitHub Pages.
#
# Uso:
#   bash scripts/configure_jupyter_termux.sh [ORIGIN]
# Ejemplo:
#   bash scripts/configure_jupyter_termux.sh https://FedericoCAlonso.github.io

ORIGIN="${1:-${NOTELAB_ORIGIN:-https://FedericoCAlonso.github.io}}"
ORIGIN="${ORIGIN%/}"

JUPYTER_DIR="${HOME}/.jupyter"
SERVER_CONFIG="${JUPYTER_DIR}/jupyter_server_config.py"
NOTEBOOK_CONFIG="${JUPYTER_DIR}/jupyter_notebook_config.py"

mkdir -p "${JUPYTER_DIR}"

backup_if_exists() {
  local file="$1"
  if [[ -f "${file}" ]]; then
    local ts
    ts="$(date +%Y%m%d_%H%M%S)"
    cp "${file}" "${file}.bak.${ts}"
    echo "Respaldo creado: ${file}.bak.${ts}"
  fi
}

backup_if_exists "${SERVER_CONFIG}"
backup_if_exists "${NOTEBOOK_CONFIG}"

cat <<EOF > "${SERVER_CONFIG}"
# Generado por NoteLab M3 (scripts/configure_jupyter_termux.sh)
c = get_config()  # noqa: F821

c.ServerApp.allow_origin = '${ORIGIN}'
c.ServerApp.allow_credentials = True
c.ServerApp.disable_check_xsrf = True
c.ServerApp.ip = '127.0.0.1'
c.ServerApp.port = 8888
EOF

cat <<EOF > "${NOTEBOOK_CONFIG}"
# Generado por NoteLab M3 (compatibilidad con jupyter notebook / ServerApp)
c = get_config()  # noqa: F821

c.NotebookApp.allow_origin = '${ORIGIN}'
c.NotebookApp.allow_credentials = True
c.NotebookApp.disable_check_xsrf = True
c.NotebookApp.ip = '127.0.0.1'
c.NotebookApp.port = 8888
EOF

echo ""
echo "Configuración completada para origen: ${ORIGIN}"
echo "  - ${SERVER_CONFIG}"
echo "  - ${NOTEBOOK_CONFIG}"
echo ""
echo "Ahora inicia Jupyter en Termux con:"
echo "  jupyter server --no-browser"
echo "(o 'jupyter lab --no-browser') y copia el token en NoteLab M3."
