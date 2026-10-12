import { writeZip, readEntry } from './zip';

const SERVICE = 'https://pwabuilder-windows-docker.azurewebsites.net/msix/generatezip';
const SERVICE_TIMEOUT_MS = 90_000;
// Windows 11 installs packages carrying this publisher OID unsigned (Add-AppxPackage -AllowUnsigned).
const UNSIGNED_PUBLISHER = 'CN=Nudge, OID.2.25.311729368913984317654407730594956997722=1';
const MAX_NAME = 50;

/** Bump when anything that goes into the package changes, so every instance builds a fresh one. */
export const INSTALLER_VERSION = '1';

export const INSTALLER_FILENAME = 'Nudge for Windows.zip';

const INSTALL_SCRIPT = [
  '@echo off',
  'title Installing Nudge',
  'echo Installing Nudge...',
  "powershell -NoProfile -ExecutionPolicy Bypass -Command \"$ErrorActionPreference = 'Stop'; " +
    "Add-AppxPackage -Path '%~dp0Nudge.msix' -AllowUnsigned; " +
    "$app = Get-StartApps -Name 'Nudge' | Select-Object -Last 1; " +
    "if ($app) { Start-Process ('shell:AppsFolder\\' + $app.AppId) }\"",
  'if errorlevel 1 (',
  '  echo.',
  '  echo Nudge could not be installed. It needs Windows 11 with Microsoft Edge.',
  '  pause',
  '  exit /b 1',
  ')',
  '',
].join('\r\n');

export class InstallerError extends Error {}

/** A package name per instance, so installs of different instances never replace each other. */
export function packageName(host: string): string {
  const name = `Nudge.${host.replace(/[^A-Za-z0-9.-]+/g, '-')}`;
  return name.length <= MAX_NAME ? name : name.slice(0, MAX_NAME).replace(/[.-]+$/, '');
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
  const archive = new Uint8Array(await response.arrayBuffer());
  const msix = await readEntry(archive, (entry) => entry.endsWith('.sideload.msix'));
  const manifest = new TextDecoder().decode(await readEntry(msix, (entry) => entry === 'AppxManifest.xml'));
  const expected = [`Name="${name}"`, `Publisher="${UNSIGNED_PUBLISHER}"`, `--app-fallback-url=${url} `];
  const missing = expected.find((part) => !manifest.includes(part));
  if (missing) throw new InstallerError(`packaging service returned a package without ${missing}`);
  return writeZip([
    { name: 'Nudge for Windows/Nudge.msix', data: msix },
    { name: 'Nudge for Windows/Install Nudge.cmd', data: new TextEncoder().encode(INSTALL_SCRIPT) },
  ]);
}
