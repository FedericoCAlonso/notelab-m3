#!/usr/bin/env bash
set -euo pipefail

# Instalador todo-en-uno para NoteLab M3 (Termux / Linux / macOS)
# - Crea un venv dedicado en ~/.local/share/notelab-venv (evita PEP 668)
# - Instala jupyter-server + ipykernel (opcionalmente jupyterlab con --with-lab)
# - Genera un token persistente en ~/.config/notelab/token (chmod 600)
# - Configura CORS estricto para la PWA en ~/.jupyter/jupyter_server_config.py
# - Instala el lanzador `notelab` en ~/.local/bin/notelab
# - En Termux (o con --with-shortcut), crea ~/.shortcuts/NoteLab.sh para Termux:Widget

ORIGIN="${NOTELAB_ORIGIN:-https://FedericoCAlonso.github.io}"
PWA_URL="${NOTELAB_PWA_URL:-}"
PORT="${NOTELAB_PORT:-8888}"
VENV_DIR="${NOTELAB_VENV_DIR:-${HOME}/.local/share/notelab-venv}"
CONFIG_DIR="${HOME}/.config/notelab"
STATE_DIR="${HOME}/.local/state/notelab"
BIN_DIR="${HOME}/.local/bin"
JUPYTER_DIR="${HOME}/.jupyter"

ROTATE_TOKEN=false
WITH_LAB=false
WITH_SHORTCUT=false
NO_INSTALL=false

print_usage() {
  cat <<'USAGE'
Uso:
  install_notelab.sh [ORIGIN] [PWA_URL] [opciones]

Opciones:
  --origin URL        Origen CORS permitido (default: https://FedericoCAlonso.github.io)
  --pwa-url URL       URL completa de la PWA (default: <ORIGIN>/notelab-m3/)
  --port NUM          Puerto de Jupyter Server (default: 8888)
  --rotate-token      Genera un nuevo token persistente aunque ya exista uno
  --with-lab          Instala jupyterlab además de jupyter-server e ipykernel
  --with-shortcut     Crea ~/.shortcuts/NoteLab.sh incluso fuera de Termux
  --no-install        Omite creación/actualización de pip dentro del venv
  -h, --help          Muestra esta ayuda
USAGE
}

POSITIONAL=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --origin)
      ORIGIN="${2:?Falta valor para --origin}"
      shift 2
      ;;
    --pwa-url)
      PWA_URL="${2:?Falta valor para --pwa-url}"
      shift 2
      ;;
    --port)
      PORT="${2:?Falta valor para --port}"
      shift 2
      ;;
    --rotate-token)
      ROTATE_TOKEN=true
      shift
      ;;
    --with-lab)
      WITH_LAB=true
      shift
      ;;
    --with-shortcut)
      WITH_SHORTCUT=true
      shift
      ;;
    --no-install)
      NO_INSTALL=true
      shift
      ;;
    -h|--help)
      print_usage
      exit 0
      ;;
    -*)
      echo "Opción desconocida: $1" >&2
      print_usage >&2
      exit 1
      ;;
    *)
      POSITIONAL+=("$1")
      shift
      ;;
  esac
done

if [[ ${#POSITIONAL[@]} -ge 1 ]]; then
  ORIGIN="${POSITIONAL[0]}"
fi
if [[ ${#POSITIONAL[@]} -ge 2 ]]; then
  PWA_URL="${POSITIONAL[1]}"
fi

ORIGIN="${ORIGIN%/}"
if [[ -z "${PWA_URL}" ]]; then
  PWA_URL="${ORIGIN}/notelab-m3/"
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "Error: python3 no está instalado." >&2
  echo "En Termux: pkg update && pkg install python" >&2
  echo "En Debian/Ubuntu: sudo apt install python3 python3-venv" >&2
  exit 1
fi

mkdir -p "${CONFIG_DIR}" "${STATE_DIR}" "${BIN_DIR}" "${JUPYTER_DIR}"

# 1. Crear / validar venv dedicado (evita error PEP 668 externally-managed-environment)
if [[ ! -x "${VENV_DIR}/bin/python" ]]; then
  echo "Creando entorno virtual aislado en ${VENV_DIR}..."
  if ! python3 -m venv "${VENV_DIR}"; then
    echo "Error al crear el venv. En Debian/Ubuntu instala: sudo apt install python3-venv" >&2
    exit 1
  fi
fi

if [[ "${NO_INSTALL}" == false ]]; then
  echo "Instalando Jupyter Server e IPyKernel en ${VENV_DIR}..."
  "${VENV_DIR}/bin/python" -m pip install --upgrade pip >/dev/null
  if [[ "${WITH_LAB}" == true ]]; then
    "${VENV_DIR}/bin/pip" install --upgrade jupyterlab ipykernel
  else
    "${VENV_DIR}/bin/pip" install --upgrade jupyter-server ipykernel
  fi
fi

if [[ ! -x "${VENV_DIR}/bin/jupyter" ]]; then
  echo "Error: no se encontró ${VENV_DIR}/bin/jupyter. Ejecuta sin --no-install." >&2
  exit 1
fi

# 2. Token persistente en ~/.config/notelab/token
TOKEN_FILE="${CONFIG_DIR}/token"
if [[ -f "${TOKEN_FILE}" && "${ROTATE_TOKEN}" == false ]]; then
  TOKEN="$(tr -d '[:space:]' < "${TOKEN_FILE}")"
else
  TOKEN=""
fi

if [[ -z "${TOKEN}" ]]; then
  TOKEN="$("${VENV_DIR}/bin/python" -c 'import secrets; print(secrets.token_hex(24))')"
  umask 077
  printf '%s\n' "${TOKEN}" > "${TOKEN_FILE}"
  chmod 600 "${TOKEN_FILE}"
  echo "Token persistente generado en ${TOKEN_FILE}"
else
  chmod 600 "${TOKEN_FILE}"
  echo "Reutilizando token persistente existente en ${TOKEN_FILE}"
fi

# 3. Detectar versión mayor de jupyter_server para usar IdentityProvider (2.x) o ServerApp.token (1.x)
JUPYTER_SERVER_MAJOR="$("${VENV_DIR}/bin/python" - <<'PY'
try:
    import jupyter_server
    print(int(str(jupyter_server.__version__).split('.')[0]))
except Exception:
    print(2)
PY
)"

backup_if_exists() {
  local file="$1"
  if [[ -f "${file}" ]]; then
    local ts
    ts="$(date +%Y%m%d_%H%M%S)"
    cp "${file}" "${file}.bak.${ts}"
  fi
}

SERVER_CONFIG="${JUPYTER_DIR}/jupyter_server_config.py"
NOTEBOOK_CONFIG="${JUPYTER_DIR}/jupyter_notebook_config.py"

backup_if_exists "${SERVER_CONFIG}"
backup_if_exists "${NOTEBOOK_CONFIG}"

umask 077
if [[ "${JUPYTER_SERVER_MAJOR}" -ge 2 ]]; then
  TOKEN_LINE="c.IdentityProvider.token = '${TOKEN}'"
else
  TOKEN_LINE="c.ServerApp.token = '${TOKEN}'"
fi

cat <<EOF > "${SERVER_CONFIG}"
# Generado por NoteLab M3 (scripts/install_notelab.sh)
c = get_config()  # noqa: F821

${TOKEN_LINE}
c.ServerApp.allow_origin = '${ORIGIN}'
c.ServerApp.allow_credentials = True
c.ServerApp.disable_check_xsrf = True
c.ServerApp.ip = '127.0.0.1'
c.ServerApp.port = ${PORT}
c.ServerApp.open_browser = False
EOF
chmod 600 "${SERVER_CONFIG}"

cat <<EOF > "${NOTEBOOK_CONFIG}"
# Generado por NoteLab M3 (compatibilidad con jupyter notebook clásico)
c = get_config()  # noqa: F821

c.NotebookApp.token = '${TOKEN}'
c.NotebookApp.allow_origin = '${ORIGIN}'
c.NotebookApp.allow_credentials = True
c.NotebookApp.disable_check_xsrf = True
c.NotebookApp.ip = '127.0.0.1'
c.NotebookApp.port = ${PORT}
c.NotebookApp.open_browser = False
EOF
chmod 600 "${NOTEBOOK_CONFIG}"

# 4. Guardar configuración del lanzador
CONFIG_ENV="${CONFIG_DIR}/config.env"
cat <<EOF > "${CONFIG_ENV}"
ORIGIN='${ORIGIN}'
PWA_URL='${PWA_URL}'
PORT='${PORT}'
VENV_DIR='${VENV_DIR}'
STATE_DIR='${STATE_DIR}'
TOKEN_FILE='${TOKEN_FILE}'
EOF
chmod 600 "${CONFIG_ENV}"

# 5. Instalar comando `notelab`
LAUNCHER="${BIN_DIR}/notelab"
cat <<'EOF' > "${LAUNCHER}"
#!/usr/bin/env bash
set -euo pipefail

CONFIG_ENV="${HOME}/.config/notelab/config.env"
if [[ ! -f "${CONFIG_ENV}" ]]; then
  echo "Falta ${CONFIG_ENV}. Ejecuta install_notelab.sh primero." >&2
  exit 1
fi
# shellcheck disable=SC1090
source "${CONFIG_ENV}"

TOKEN="$(tr -d '[:space:]' < "${TOKEN_FILE}")"
PID_FILE="${STATE_DIR}/jupyter.pid"
LOG_FILE="${STATE_DIR}/jupyter.log"
SERVER_HTTP="http://127.0.0.1:${PORT}"
PWA_SERVER_URL="http://localhost:${PORT}"
DEEP_LINK="${PWA_URL%%#*}#server=${PWA_SERVER_URL}&token=${TOKEN}"

mkdir -p "${STATE_DIR}"

is_server_up() {
  "${VENV_DIR}/bin/python" - "${SERVER_HTTP}/api" <<'PY'
import sys, urllib.request
try:
    with urllib.request.urlopen(sys.argv[1], timeout=1.5) as resp:
        sys.exit(0 if resp.status < 500 else 1)
except Exception:
    sys.exit(1)
PY
}

cmd="${1:-start}"
case "${cmd}" in
  status)
    if is_server_up; then
      echo "Jupyter Server activo en ${PWA_SERVER_URL}"
      exit 0
    else
      echo "Jupyter Server detenido"
      exit 1
    fi
    ;;
  stop)
    if [[ -f "${PID_FILE}" ]]; then
      pid="$(cat "${PID_FILE}")"
      if kill -0 "${pid}" 2>/dev/null; then
        kill "${pid}"
        echo "Jupyter Server detenido (PID ${pid})"
      fi
      rm -f "${PID_FILE}"
    else
      echo "No se encontró PID guardado en ${PID_FILE}"
    fi
    exit 0
    ;;
  logs)
    tail -n 60 -f "${LOG_FILE}"
    exit 0
    ;;
  url)
    printf '%s\n' "${DEEP_LINK}"
    exit 0
    ;;
  start|"")
    ;;
  *)
    echo "Uso: notelab [start|status|stop|logs|url]" >&2
    exit 1
    ;;
esac

if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock >/dev/null 2>&1 || true
fi

if ! is_server_up; then
  echo "Iniciando Jupyter Server en puerto ${PORT}..."
  nohup "${VENV_DIR}/bin/jupyter" server --no-browser > "${LOG_FILE}" 2>&1 &
  echo $! > "${PID_FILE}"

  ready=false
  for _ in $(seq 1 50); do
    if is_server_up; then
      ready=true
      break
    fi
    sleep 0.3
  done

  if [[ "${ready}" != true ]]; then
    echo "Jupyter Server no respondió a tiempo. Últimas líneas de ${LOG_FILE}:" >&2
    tail -n 25 "${LOG_FILE}" >&2 || true
    exit 1
  fi
fi

if command -v termux-open-url >/dev/null 2>&1; then
  termux-open-url "${DEEP_LINK}"
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "${DEEP_LINK}" >/dev/null 2>&1 &
elif command -v open >/dev/null 2>&1; then
  open "${DEEP_LINK}"
else
  echo "Abre esta URL en tu navegador:"
  printf '%s\n' "${DEEP_LINK}"
fi
EOF
chmod 700 "${LAUNCHER}"

# 6. Crear acceso directo Termux:Widget si estamos en Termux o si se solicitó
IS_TERMUX=false
if [[ -n "${TERMUX_VERSION:-}" || "${PREFIX:-}" == *"com.termux"* ]]; then
  IS_TERMUX=true
fi

if [[ "${IS_TERMUX}" == true || "${WITH_SHORTCUT}" == true ]]; then
  SHORTCUTS_DIR="${HOME}/.shortcuts"
  mkdir -p "${SHORTCUTS_DIR}"
  cat <<EOF > "${SHORTCUTS_DIR}/NoteLab.sh"
#!/usr/bin/env bash
exec "${LAUNCHER}" start
EOF
  chmod 700 "${SHORTCUTS_DIR}/NoteLab.sh"
  echo "Acceso directo Termux:Widget creado en ${SHORTCUTS_DIR}/NoteLab.sh"
fi

# 7. Asegurar ~/.local/bin en PATH para shells comunes
PATH_LINE='export PATH="$HOME/.local/bin:$PATH"'
ADDED_PATH=false
for rc in "${HOME}/.bashrc" "${HOME}/.zshrc"; do
  if [[ -f "${rc}" ]] && ! grep -Fq '.local/bin' "${rc}"; then
    printf '\n# Agregado por NoteLab M3\n%s\n' "${PATH_LINE}" >> "${rc}"
    ADDED_PATH=true
  fi
done

echo ""
echo "Instalación completada."
echo "  - Venv:      ${VENV_DIR}"
echo "  - Config:    ${SERVER_CONFIG}"
echo "  - Token:     ${TOKEN_FILE}"
echo "  - Lanzador:  ${LAUNCHER}"
echo "  - PWA URL:   ${PWA_URL}"
echo ""
if [[ "${ADDED_PATH}" == true ]] || [[ ":${PATH}:" != *":${BIN_DIR}:"* ]]; then
  echo "Ejecuta 'export PATH=\"\$HOME/.local/bin:\$PATH\"' (o reinicia tu terminal) y luego corre:"
else
  echo "Ejecuta:"
fi
echo "  notelab"
