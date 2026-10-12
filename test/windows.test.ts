import { expect, test } from 'bun:test';
import { InstallerError, buildInstaller, packageName } from '../src/worker/windows';
import { readEntry, writeZip } from '../src/worker/zip';

const ORIGIN = 'https://nudge.example';
const NAME = packageName('nudge.example');
const UNSIGNED = 'CN=Nudge, OID.2.25.311729368913984317654407730594956997722=1';
const encode = (text: string) => new TextEncoder().encode(text);

function serviceZip(manifest: string): Uint8Array {
  const msix = writeZip([{ name: 'AppxManifest.xml', data: encode(manifest) }]);
  return writeZip([
    { name: 'Nudge.msixbundle', data: encode('bundle') },
    { name: 'Nudge.sideload.msix', data: msix },
  ]);
}

const manifest = (name: string, publisher: string, url: string) =>
  `<Identity Name="${name}" Publisher="${publisher}"/><Application uap10:Parameters="--app-fallback-url=${url} --display-mode=standalone"/>`;

test('the installer wraps the package the service built for this origin', async () => {
  const installer = await buildInstaller(
    ORIGIN,
    async () => new Response(serviceZip(manifest(NAME, UNSIGNED, `${ORIGIN}/`))),
  );
  const msix = await readEntry(installer, (name) => name === 'Nudge for Windows/Nudge.msix');
  expect(new TextDecoder().decode(await readEntry(msix, (name) => name === 'AppxManifest.xml'))).toContain(NAME);
  const script = await readEntry(installer, (name) => name.endsWith('Install Nudge.cmd'));
  expect(new TextDecoder().decode(script)).toContain('-AllowUnsigned');
});

test.each([
  ['for another instance', manifest(NAME, UNSIGNED, 'https://other.example/')],
  ['under another package name', manifest('Nudge.other', UNSIGNED, `${ORIGIN}/`)],
  ['that would need a signature', manifest(NAME, 'CN=Nudge', `${ORIGIN}/`)],
])('a package %s is refused', async (_, appx) => {
  const built = buildInstaller(ORIGIN, async () => new Response(serviceZip(appx)));
  expect(await built.catch((error: unknown) => error)).toBeInstanceOf(InstallerError);
});

test('a failing packaging service is an error, not an installer', async () => {
  const built = buildInstaller(ORIGIN, async () => new Response('down', { status: 503 }));
  expect(await built.catch((error: unknown) => error)).toBeInstanceOf(InstallerError);
});

test.each([
  ['nudge.example', 'Nudge.nudge.example'],
  ['my_host.example', 'Nudge.my-host.example'],
  ['a'.repeat(60) + '.example', ('Nudge.' + 'a'.repeat(60)).slice(0, 50)],
])('package names stay valid: %s', (host, expected) => {
  expect(packageName(host)).toBe(expected);
});
