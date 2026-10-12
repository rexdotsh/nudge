import { readBounded } from './body';
import { readEntry, writeZip } from './zip';

const SERVICE = 'https://pwabuilder-windows-docker.azurewebsites.net/msix/generatezip';
const SERVICE_TIMEOUT_MS = 90_000;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
// Windows 11 installs packages carrying this publisher OID unsigned (Add-AppxPackage -AllowUnsigned).
const UNSIGNED_PUBLISHER = 'CN=Nudge, OID.2.25.311729368913984317654407730594956997722=1';
const MAX_NAME = 50;

export const INSTALLER_FILENAME = 'Nudge for Windows.zip';

export class InstallerError extends Error {}

function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (const char of new TextEncoder().encode(text)) hash = Math.imul(hash ^ char, 0x01000193) >>> 0;
  return hash.toString(16).padStart(8, '0');
}

/** A package name per instance, so installs of different instances never replace each other. */
export function packageName(host: string): string {
  const name = `Nudge.${host.replace(/[^A-Za-z0-9.-]+/g, '-')}`;
  if (name.length <= MAX_NAME) return name;
  const suffix = `.${fnv1a(host)}`;
  return `${name.slice(0, MAX_NAME - suffix.length).replace(/[.-]+$/, '')}${suffix}`;
}

function installScript(name: string): string {
  return [
    '@echo off',
    'title Installing Nudge',
    'echo Installing Nudge...',
    "powershell -NoProfile -ExecutionPolicy Bypass -Command \"$ErrorActionPreference = 'Stop'; " +
      "Add-AppxPackage -Path '%~dp0Nudge.msix' -AllowUnsigned; " +
      `$package = Get-AppxPackage -Name '${name}'; ` +
      "Start-Process ('shell:AppsFolder\\' + $package.PackageFamilyName + '!App')\"",
    'if errorlevel 1 (',
    '  echo.',
    '  echo Nudge could not be installed. It needs Windows 11 with Microsoft Edge.',
    '  pause',
    '  exit /b 1',
    ')',
    '',
  ].join('\r\n');
}

function attributes(element: string): Map<string, string> {
  return new Map([...element.matchAll(/([\w:]+)="([^"]*)"/g)].map(([, key = '', value = '']) => [key, value]));
}

// The package is only served if it is unmistakably this instance's: one identity with our name and the unsigned
// publisher, and every Edge launch parameter falling back to this origin.
function checkManifest(xml: string, name: string, url: string): void {
  const body = xml.replace(/<!--[\s\S]*?-->/g, '');
  const identities = [...body.matchAll(/<Identity\b[^>]*>/g)];
  const identity = attributes(identities[0]?.[0] ?? '');
  if (identities.length !== 1 || identity.get('Name') !== name || identity.get('Publisher') !== UNSIGNED_PUBLISHER) {
    throw new InstallerError('the packaging service returned a package with the wrong identity');
  }
  const fallbacks = [...body.matchAll(/--app-fallback-url=(\S+)/g)].map(([, value]) => value);
  if (fallbacks.length === 0 || fallbacks.some((value) => value !== url)) {
    throw new InstallerError('the packaging service returned a package for another address');
  }
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export async function buildInstaller(origin: string, request: Fetch = fetch): Promise<Uint8Array> {
  const url = `${origin}/`;
  const name = packageName(new URL(origin).host);
  const response = await request(SERVICE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(SERVICE_TIMEOUT_MS),
    body: JSON.stringify({
      name: 'Nudge',
      packageId: name,
      url,
      version: '1.0.0.0',
      allowSigning: true,
      publisher: { displayName: 'Nudge', commonName: 'CN=Nudge' },
      generateModernPackage: true,
      classicPackage: { generate: false, version: '1.0.0.0', url },
      edgeHtmlPackage: { generate: false },
      manifestUrl: `${origin}/manifest.webmanifest`,
      images: { baseImage: `${origin}/icons/icon-512.png`, backgroundColor: 'transparent', padding: 0 },
      resourceLanguage: 'en-us',
      enableWebAppWidgets: false,
      extensions: 'appurihandler',
    }),
  });
  if (!response.ok) throw new InstallerError(`packaging service responded ${response.status}`);
  const archive = await readBounded(response, MAX_RESPONSE_BYTES);
  if (!archive) throw new InstallerError('the packaging service returned too much');
  const msix = await readEntry(archive, (entry) => entry.endsWith('.sideload.msix'), MAX_RESPONSE_BYTES);
  checkManifest(
    new TextDecoder().decode(await readEntry(msix, (entry) => entry === 'AppxManifest.xml', 1 << 20)),
    name,
    url,
  );
  return writeZip([
    { name: 'Nudge for Windows/Nudge.msix', data: msix },
    { name: 'Nudge for Windows/Install Nudge.cmd', data: new TextEncoder().encode(installScript(name)) },
  ]);
}
