import { CellOutput, normalizeMultiline } from '../../types/nbformat';
import type { ExecutionResult } from '../jupyter/JupyterGateway';

/**
 * Package management through the *running kernel*: pip is invoked with the kernel's own
 * `sys.executable`, so packages always land in the environment the notebook actually uses.
 */

export interface PackageExecutorOptions {
  onOutput?: (outputs: CellOutput[]) => void;
  timeoutMs?: number;
}

export type PackageExecutor = (
  code: string,
  options?: PackageExecutorOptions
) => Promise<ExecutionResult>;

export interface InstalledPackage {
  name: string;
  version: string;
}

export interface PackageOperationResult {
  ok: boolean;
  log: string;
  error?: string;
}

export interface InstalledPackagesResult {
  packages: InstalledPackage[];
  pythonPath: string | null;
}

const EXIT_MARKER = '__NOTELAB_PIP_EXIT__=';
const LIST_MARKER = '__NOTELAB_PIP_LIST__';
const PYTHON_MARKER = '__NOTELAB_PY__';

const INSTALL_TIMEOUT_MS = 15 * 60 * 1000;
const LIST_TIMEOUT_MS = 60 * 1000;

/** Import name -> PyPI distribution name, for the common cases where they differ. */
export const IMPORT_TO_PACKAGE: Record<string, string> = {
  cv2: 'opencv-python',
  sklearn: 'scikit-learn',
  skimage: 'scikit-image',
  PIL: 'pillow',
  yaml: 'pyyaml',
  bs4: 'beautifulsoup4',
  dateutil: 'python-dateutil',
  dotenv: 'python-dotenv',
  serial: 'pyserial',
  OpenSSL: 'pyopenssl',
  Crypto: 'pycryptodome',
  jwt: 'pyjwt',
  git: 'gitpython',
  docx: 'python-docx',
  pptx: 'python-pptx',
  fitz: 'pymupdf',
  attr: 'attrs',
  magic: 'python-magic',
  zmq: 'pyzmq',
  usb: 'pyusb',
  telegram: 'python-telegram-bot',
  mpl_toolkits: 'matplotlib',
  pylab: 'matplotlib',
};

const NAME_PART = '[A-Za-z0-9][A-Za-z0-9._-]*';
const EXTRAS_PART = '(?:\\[[A-Za-z0-9._,-]+\\])?';
const VERSION_OP = '(?:===|==|>=|<=|~=|!=|>|<)';
const VERSION_VALUE = '[A-Za-z0-9.*+!_-]+';
const PACKAGE_SPEC_REGEX = new RegExp(
  `^${NAME_PART}${EXTRAS_PART}(?:${VERSION_OP}${VERSION_VALUE}(?:,${VERSION_OP}${VERSION_VALUE})*)?$`
);

/**
 * Only plain PyPI requirement specs are allowed (name, extras, version pins).
 * Rejects options (`--index-url`), URLs, paths and anything shell/pip-flag-like.
 */
export function isValidPackageSpec(spec: string): boolean {
  if (!spec || spec.length > 120) return false;
  if (spec.startsWith('-')) return false;
  return PACKAGE_SPEC_REGEX.test(spec);
}

export function parsePackageInput(text: string): { valid: string[]; invalid: string[] } {
  const tokens = text
    .split(/[\s;]+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const token of tokens) {
    if (isValidPackageSpec(token)) {
      if (!valid.includes(token)) valid.push(token);
    } else {
      invalid.push(token);
    }
  }
  return { valid, invalid };
}

export function mapImportToPackage(importName: string): string {
  const top = importName.split('.')[0] ?? importName;
  return IMPORT_TO_PACKAGE[top] ?? top;
}

/**
 * Detects `ModuleNotFoundError: No module named 'x.y'` and returns the top-level import name.
 */
export function parseMissingModule(ename: string, evalue: string): string | null {
  if (ename !== 'ModuleNotFoundError') return null;
  const match = evalue.match(/No module named ['"]([^'"]+)['"]/);
  const full = match?.[1];
  if (!full) return null;
  const top = full.split('.')[0];
  if (!top || top.startsWith('_')) return null;
  return top;
}

function toPythonList(items: string[]): string {
  return `[${items.map((i) => JSON.stringify(i)).join(', ')}]`;
}

export function buildPipRunCode(action: 'install' | 'uninstall', specs: string[]): string {
  const pipArgs =
    action === 'install'
      ? '["install", "--disable-pip-version-check"]'
      : '["uninstall", "-y", "--disable-pip-version-check"]';

  return [
    'def __notelab_pip():',
    '    import importlib, subprocess, sys',
    `    pkgs = ${toPythonList(specs)}`,
    '    print("Python: " + sys.executable, flush=True)',
    `    cmd = [sys.executable, "-m", "pip", *${pipArgs}, *pkgs]`,
    '    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)',
    '    for line in proc.stdout:',
    '        print(line, end="", flush=True)',
    '    rc = proc.wait()',
    '    importlib.invalidate_caches()',
    '    if rc != 0 and "com.termux" in sys.executable:',
    '        print("\\nTip Termux: numpy, scipy, pandas y similares se instalan mejor con `pkg install python-numpy` etc.")',
    `    print("\\n${EXIT_MARKER}" + str(rc), flush=True)`,
    '__notelab_pip()',
    'del __notelab_pip',
  ].join('\n');
}

export function buildPipListCode(): string {
  return [
    'def __notelab_pip_list():',
    '    import subprocess, sys',
    '    p = subprocess.run(',
    '        [sys.executable, "-m", "pip", "list", "--format=json", "--disable-pip-version-check"],',
    '        capture_output=True, text=True,',
    '    )',
    `    print("${PYTHON_MARKER}" + sys.executable)`,
    `    print("${LIST_MARKER}" + ((p.stdout or "").strip() or "[]"))`,
    '    if p.returncode != 0:',
    '        print((p.stderr or "").strip())',
    '__notelab_pip_list()',
    'del __notelab_pip_list',
  ].join('\n');
}

export function collectStdout(outputs: CellOutput[]): string {
  return outputs
    .filter((o): o is Extract<CellOutput, { output_type: 'stream' }> => o.output_type === 'stream')
    .filter((o) => o.name === 'stdout')
    .map((o) => normalizeMultiline(o.text))
    .join('');
}

function collectErrorMessage(outputs: CellOutput[]): string | undefined {
  const err = outputs.find((o) => o.output_type === 'error');
  if (err && err.output_type === 'error') {
    return `${err.ename}: ${err.evalue}`;
  }
  return undefined;
}

function stripMarkers(log: string): string {
  return log
    .split('\n')
    .filter((line) => !line.startsWith(EXIT_MARKER))
    .join('\n')
    .trimEnd();
}

async function runPip(
  exec: PackageExecutor,
  action: 'install' | 'uninstall',
  specs: string[],
  onLog?: (log: string) => void
): Promise<PackageOperationResult> {
  const invalid = specs.filter((s) => !isValidPackageSpec(s));
  if (specs.length === 0 || invalid.length > 0) {
    return {
      ok: false,
      log: '',
      error:
        specs.length === 0
          ? 'Indica al menos un paquete'
          : `Nombre de paquete no válido: ${invalid.join(', ')}`,
    };
  }

  try {
    const result = await exec(buildPipRunCode(action, specs), {
      timeoutMs: INSTALL_TIMEOUT_MS,
      onOutput: (outputs) => onLog?.(stripMarkers(collectStdout(outputs))),
    });

    const stdout = collectStdout(result.outputs);
    const exitMatch = stdout.match(new RegExp(`${EXIT_MARKER}(-?\\d+)`));
    const exitCode = exitMatch ? Number(exitMatch[1]) : result.hasError ? 1 : 0;
    const log = stripMarkers(stdout);

    return {
      ok: exitCode === 0 && !result.hasError,
      log,
      error:
        exitCode === 0 && !result.hasError
          ? undefined
          : collectErrorMessage(result.outputs) ?? `pip terminó con código ${exitCode}`,
    };
  } catch (error) {
    return {
      ok: false,
      log: '',
      error: error instanceof Error ? error.message : 'No se pudo ejecutar pip en el kernel',
    };
  }
}

export function installPackages(
  exec: PackageExecutor,
  specs: string[],
  onLog?: (log: string) => void
): Promise<PackageOperationResult> {
  return runPip(exec, 'install', specs, onLog);
}

export function uninstallPackages(
  exec: PackageExecutor,
  specs: string[],
  onLog?: (log: string) => void
): Promise<PackageOperationResult> {
  return runPip(exec, 'uninstall', specs, onLog);
}

export async function listInstalledPackages(
  exec: PackageExecutor
): Promise<InstalledPackagesResult> {
  const result = await exec(buildPipListCode(), { timeoutMs: LIST_TIMEOUT_MS });
  const stdout = collectStdout(result.outputs);

  let pythonPath: string | null = null;
  let packages: InstalledPackage[] = [];

  for (const line of stdout.split('\n')) {
    if (line.startsWith(PYTHON_MARKER)) {
      pythonPath = line.slice(PYTHON_MARKER.length).trim() || null;
    } else if (line.startsWith(LIST_MARKER)) {
      try {
        const parsed = JSON.parse(line.slice(LIST_MARKER.length)) as Array<{
          name?: string;
          version?: string;
        }>;
        packages = parsed
          .filter((p) => typeof p.name === 'string')
          .map((p) => ({ name: p.name as string, version: p.version ?? '' }))
          .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
      } catch {
        packages = [];
      }
    }
  }

  if (result.hasError && packages.length === 0) {
    throw new Error(collectErrorMessage(result.outputs) ?? 'No se pudo listar los paquetes');
  }

  return { packages, pythonPath };
}
