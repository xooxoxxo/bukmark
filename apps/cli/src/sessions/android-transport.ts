import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { get } from 'node:http';

export interface AndroidTarget { id: string; type: string; url: string }

export function connectAndroidUsb(adb = 'adb') {
  let device = ['-d'];
  function run(...args: string[]): string {
    try {
      return execFileSync(adb, [...device, ...args], {
        encoding: 'utf8', timeout: 15_000, stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    } catch {
      throw new Error('ADB could not reach the authorized USB phone.');
    }
  }
  const serial = run('get-serialno');
  if (!serial || serial === 'unknown') throw new Error('ADB could not identify the USB phone.');
  device = ['-s', serial];
  function assertForeground() {
    const focus = run('shell', 'dumpsys', 'window').split('\n').find(line => line.includes('mCurrentFocus='));
    if (!focus?.includes('com.android.chrome/')) throw new Error('Leave Chrome’s regular tab switcher visible on the phone.');
  }
  assertForeground();
  const port = Number(run('forward', '--no-rebind', 'tcp:0', 'localabstract:chrome_devtools_remote'));
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('ADB did not return a usable local port.');

  function request(path: string): Promise<Buffer> {
    if (!['/json/version', '/json/list', '/json/list?for_tab'].includes(path) && !/^\/json\/close\/\d+$/.test(path)) {
      throw new Error('Unsupported Android metadata request.');
    }
    return new Promise((resolve, reject) => {
      const request = get({ hostname: '127.0.0.1', port, path, agent: false }, async response => {
        try {
          if (response.statusCode !== 200) throw new Error(`Chrome returned HTTP ${response.statusCode}.`);
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of response) {
            size += chunk.length;
            if (size > 32 * 1024 * 1024) throw new Error('Chrome metadata exceeded the local capture limit.');
            chunks.push(chunk);
          }
          resolve(Buffer.concat(chunks));
        } catch (error) {
          response.destroy();
          reject(error);
        }
      });
      request.setTimeout(10_000, () => request.destroy(new Error('Chrome metadata timed out.')));
      request.on('error', reject);
    });
  }

  return {
    fingerprint: createHash('sha256').update(serial).digest('hex'),
    assertForeground,
    assertSwitcher() {
      assertForeground();
      const xml = run('exec-out', 'uiautomator', 'dump', '/dev/tty');
      if (!xml.includes('resource-id="com.android.chrome:id/tab_switcher_view_holder"')) {
        throw new Error('Could not verify Chrome’s tab switcher.');
      }
    },
    async json(path: string): Promise<unknown> {
      const body = await request(path);
      try { return JSON.parse(body.toString('utf8')); }
      catch { throw new Error('Chrome tab metadata is not valid JSON.'); }
    },
    async close(id: string) {
      if (!/^\d+$/.test(id)) throw new Error('Expected a numeric Android tab ID.');
      await request(`/json/close/${id}`);
    },
    disconnect() { run('forward', '--remove', `tcp:${port}`); },
  };
}

export function readAndroidTargets(value: unknown): AndroidTarget[] {
  if (!Array.isArray(value)) throw new Error('Chrome did not return a tab list.');
  const ids = new Set<string>();
  return value.filter(row => row?.type === 'page' || row?.type === 'tab').map(row => {
    if (typeof row.id !== 'string' || typeof row.url !== 'string' || ids.has(row.id)) {
      throw new Error('Chrome returned ambiguous tab identities.');
    }
    ids.add(row.id);
    return { id: row.id, type: row.type, url: row.url };
  });
}
