import { expect, test } from 'bun:test';
import { InstallerError, buildInstaller, packageName } from '../src/worker/windows';
import { readEntry, writeZip } from '../src/worker/zip';

const ORIGIN = 'https://nudge.example';
const NAME = packageName('nudge.example');
const UNSIGNED = 'CN=Nudge, OID.2.25.311729368913984317654407730594956997722=1';
const encode = (text: string) => new TextEncoder().encode(text);
const decode = (data: Uint8Array) => new TextDecoder().decode(data);
const MB = 1 << 20;

function serviceZip(manifest: string): Uint8Array {
  const msix = writeZip([{ name: 'AppxManifest.xml', data: encode(manifest) }]);
  return writeZip([
    { name: 'Nudge.msixbundle', data: encode('bundle') },
    { name: 'Nudge.sideload.msix', data: msix },
  ]);
}

const identity = (name: string, publisher: string) => `<Identity Name="${name}" Publisher="${publisher}"/>`;
const application = (url: string) =>
  `<Application uap10:Parameters="--app-fallback-url=${url} --display-mode=standalone"/>`;
const good = identity(NAME, UNSIGNED) + application(`${ORIGIN}/`);
const serve =
  (body: Uint8Array | string, status = 200) =>
  async () =>
    new Response(body, { status });

test("the installer wraps this origin's package with a script that opens exactly that package", async () => {
  const installer = await buildInstaller(ORIGIN, serve(serviceZip(good)));
  const msix = await readEntry(installer, (name) => name === 'Nudge for Windows/Nudge.msix', MB);
  expect(decode(await readEntry(msix, (name) => name === 'AppxManifest.xml', MB))).toBe(good);
  const script = decode(await readEntry(installer, (name) => name.endsWith('Install Nudge.cmd'), MB));
  expect(script).toContain('-AllowUnsigned');
  expect(script).toContain(`Get-AppxPackage -Name '${NAME}'`);
});

test.each([
  ['for another instance', identity(NAME, UNSIGNED) + application('https://other.example/')],
  ['with one launch parameter for another instance', good + application('https://other.example/')],
  ['under another package name', identity('Nudge.other', UNSIGNED) + application(`${ORIGIN}/`)],
  ['that would need a signature', identity(NAME, 'CN=Nudge') + application(`${ORIGIN}/`)],
  [
    'whose real identity hides behind a decoy in a comment',
    `<!--${identity(NAME, UNSIGNED)}-->${identity('Nudge.other', UNSIGNED)}${application(`${ORIGIN}/`)}`,
  ],
  ['with two identities', good + identity(NAME, UNSIGNED)],
])('a package %s is refused', async (_, manifest) => {
  const built = buildInstaller(ORIGIN, serve(serviceZip(manifest)));
  expect(await built.catch((error: unknown) => error)).toBeInstanceOf(InstallerError);
});

function corrupt(change: (zip: Uint8Array) => Uint8Array): Uint8Array {
  return change(serviceZip(good).slice());
}

test.each([
  ['a failing service', serve('down', 503)],
  ['a response that is not a zip', serve('<html>busy</html>')],
  ['a truncated zip', serve(corrupt((zip) => zip.subarray(0, zip.length - 40)))],
  [
    'a zip whose package bytes were altered',
    serve(
      corrupt((zip) => {
        zip[200] = (zip[200] ?? 0) ^ 0xff;
        return zip;
      }),
    ),
  ],
])('%s never becomes an installer', async (_, request) => {
  const result = await buildInstaller(ORIGIN, request).catch((error: unknown) => error);
  expect(result).toBeInstanceOf(Error);
});

test('an entry that inflates past its limit is refused', async () => {
  const deflated = new Uint8Array(
    await new Response(
      new Blob([new Uint8Array(4 * MB)]).stream().pipeThrough(new CompressionStream('deflate-raw')),
    ).arrayBuffer(),
  );
  const zip = writeZip([{ name: 'big', data: deflated }]);
  const view = new DataView(zip.buffer);
  const central = zip.length - 22 - (46 + 3);
  view.setUint16(central + 10, 8, true);
  const read = readEntry(zip, (name) => name === 'big', MB);
  expect(String(await read.catch((error: unknown) => error))).toContain('past its limit');
});

test.each([
  ['nudge.example', 'Nudge.nudge.example'],
  ['my_host.example', 'Nudge.my-host.example'],
])('package names stay readable for short hosts: %s', (host, expected) => {
  expect(packageName(host)).toBe(expected);
});

test('long hosts sharing a prefix still get distinct, valid package names', () => {
  const prefix = 'a'.repeat(60);
  const names = [`${prefix}.one.example`, `${prefix}.two.example`].map(packageName);
  expect(new Set(names).size).toBe(2);
  for (const name of names) expect(name).toMatch(/^[A-Za-z0-9.-]{3,50}$/);
});
