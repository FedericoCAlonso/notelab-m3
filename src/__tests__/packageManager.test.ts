import { describe, expect, it, vi } from 'vitest';
import {
  PackageExecutor,
  buildPipRunCode,
  installPackages,
  isValidPackageSpec,
  listInstalledPackages,
  mapImportToPackage,
  parseMissingModule,
  parsePackageInput,
  uninstallPackages,
} from '../services/python/packageManager';
import { JupyterHttpWebSocketGateway } from '../services/jupyter/JupyterGateway';
import { ExecutionResult } from '../services/jupyter/JupyterGateway';

function streamResult(text: string, hasError = false): ExecutionResult {
  return {
    executionCount: null,
    hasError,
    outputs: [{ output_type: 'stream', name: 'stdout', text }],
  };
}

describe('packageManager', () => {
  it('accepts plain PyPI specs and rejects flags, URLs, paths and shell tricks', () => {
    for (const ok of [
      'numpy',
      'scikit-learn',
      'matplotlib==3.9.0',
      'pandas>=2.0,<3',
      'requests[socks]',
      'Pillow',
    ]) {
      expect(isValidPackageSpec(ok), ok).toBe(true);
    }
    for (const bad of [
      '--index-url',
      '--upgrade',
      '-r',
      'https://evil.example/x.whl',
      'git+https://github.com/a/b',
      './local/path',
      '../x',
      'numpy;rm',
      'a b',
      '$(whoami)',
      '`id`',
      '',
    ]) {
      expect(isValidPackageSpec(bad), bad).toBe(false);
    }
  });

  it('splits user input into valid and invalid tokens without duplicates', () => {
    expect(parsePackageInput('numpy  pandas\nnumpy --user matplotlib==3.9.0')).toEqual({
      valid: ['numpy', 'pandas', 'matplotlib==3.9.0'],
      invalid: ['--user'],
    });
  });

  it('maps import names to PyPI package names and detects missing modules', () => {
    expect(mapImportToPackage('cv2')).toBe('opencv-python');
    expect(mapImportToPackage('sklearn.linear_model')).toBe('scikit-learn');
    expect(mapImportToPackage('numpy')).toBe('numpy');

    expect(parseMissingModule('ModuleNotFoundError', "No module named 'numpy'")).toBe('numpy');
    expect(parseMissingModule('ModuleNotFoundError', "No module named 'scipy.stats'")).toBe('scipy');
    expect(parseMissingModule('ImportError', "No module named 'numpy'")).toBeNull();
    expect(parseMissingModule('ModuleNotFoundError', "No module named '_private'")).toBeNull();
  });

  it('builds pip code that uses the kernel interpreter and embeds safe literals only', () => {
    const code = buildPipRunCode('install', ['numpy', 'pandas>=2.0']);
    expect(code).toContain('sys.executable, "-m", "pip"');
    expect(code).toContain('["numpy", "pandas>=2.0"]');
    expect(code).toContain('"install"');
    expect(buildPipRunCode('uninstall', ['numpy'])).toContain('"uninstall", "-y"');
  });

  it('installs through the executor, streams logs and reports the exit code', async () => {
    const exec: PackageExecutor = vi.fn(async (_code, options) => {
      const partial = 'Python: /env/bin/python\nCollecting numpy\n';
      options?.onOutput?.([{ output_type: 'stream', name: 'stdout', text: partial }]);
      return streamResult(`${partial}Successfully installed numpy-2.0\n\n__NOTELAB_PIP_EXIT__=0\n`);
    });
    const logs: string[] = [];

    const res = await installPackages(exec, ['numpy'], (l) => logs.push(l));
    expect(res.ok).toBe(true);
    expect(res.log).toContain('Successfully installed numpy-2.0');
    expect(res.log).not.toContain('__NOTELAB_PIP_EXIT__');
    expect(logs[0]).toContain('Collecting numpy');
    expect(vi.mocked(exec).mock.calls[0]?.[1]?.timeoutMs).toBeGreaterThan(60_000);
  });

  it('reports failures (non-zero exit) and refuses invalid specs without calling the kernel', async () => {
    const failing: PackageExecutor = vi.fn(async () =>
      streamResult('ERROR: No matching distribution\n\n__NOTELAB_PIP_EXIT__=1\n')
    );
    const failed = await installPackages(failing, ['nonexistent-pkg-xyz']);
    expect(failed.ok).toBe(false);
    expect(failed.error).toMatch(/código 1/);

    const never: PackageExecutor = vi.fn();
    const rejected = await installPackages(never, ['--index-url=http://evil']);
    expect(rejected.ok).toBe(false);
    expect(never).not.toHaveBeenCalled();

    const removed = await uninstallPackages(
      vi.fn(async () => streamResult('Successfully uninstalled numpy\n\n__NOTELAB_PIP_EXIT__=0\n')),
      ['numpy']
    );
    expect(removed.ok).toBe(true);
  });

  it('lists installed packages and the kernel python path', async () => {
    const exec: PackageExecutor = vi.fn(async () =>
      streamResult(
        '__NOTELAB_PY__/home/u/jupyter-env/bin/python\n' +
          '__NOTELAB_PIP_LIST__[{"name":"numpy","version":"2.0.1"},{"name":"Babel","version":"2.15"}]\n'
      )
    );
    const res = await listInstalledPackages(exec);
    expect(res.pythonPath).toBe('/home/u/jupyter-env/bin/python');
    expect(res.packages.map((p) => p.name)).toEqual(['Babel', 'numpy']);
  });
});

describe('JupyterGateway executeCode options', () => {
  it('honors storeHistory=false in the execute_request', async () => {
    const sent: string[] = [];
    class FakeSocket {
      static OPEN = 1;
      readyState = 1;
      onopen: (() => void) | null = null;
      onmessage: ((e: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: (() => void) | null = null;
      constructor() {
        setTimeout(() => this.onopen?.(), 0);
      }
      send(data: string) {
        sent.push(data);
      }
      close() {}
    }
    vi.stubGlobal('WebSocket', FakeSocket);

    const gw = new JupyterHttpWebSocketGateway('http://localhost:8888', 'tok');
    void gw
      .executeCode('k1', 'print(1)', { storeHistory: false, timeoutMs: 1000 })
      .catch(() => undefined);
    await new Promise((r) => setTimeout(r, 20));

    const msg = JSON.parse(sent[0] ?? '{}');
    expect(msg.content.store_history).toBe(false);
    gw.disconnectWebSocket();
    vi.unstubAllGlobals();
  });
});
