import { readBounded } from './body';
import { readEntry, writeZip } from './zip';

const SERVICE = 'https://pwabuilder-windows-docker.azurewebsites.net/msix/generatezip';
const SERVICE_TIMEOUT_MS = 90_000;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
// Windows 11 installs packages carrying this publisher OID unsigned (Add-AppxPackage -AllowUnsigned).
const UNSIGNED_PUBLISHER = 'CN=Nudge, OID.2.25.311729368913984317654407730594956997722=1';
const MAX_NAME = 50;

const INSTALLER_FILENAME = 'Nudge for Windows.zip';

export class InstallerError extends Error {}

export interface InstallerRequest {
  method: string;
  origin: string;
  token: string;
}

export interface InstallerDeps {
  verify: (token: string) => Promise<string | null>;
  enrolled: (deviceId: string) => Promise<boolean>;
  build: (origin: string) => Promise<Uint8Array>;
}

/** Only an enrolled device can make this instance call the packaging service. */
export async function serveInstaller(
  { method, origin, token }: InstallerRequest,
  deps: InstallerDeps,
): Promise<Response> {
  if (method !== 'POST') return new Response('method not allowed', { status: 405 });
  const deviceId = await deps.verify(token);
  if (deviceId === null || !(await deps.enrolled(deviceId))) return new Response(null, { status: 401 });
  try {
    return new Response(await deps.build(origin), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${INSTALLER_FILENAME}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('could not build the Windows installer', error);
    return new Response('The Windows installer could not be built right now. Try again in a minute.', { status: 503 });
  }
}

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
    'set "NUDGE_PACKAGE=%~dp0Nudge.msix"',
    "powershell -NoProfile -ExecutionPolicy Bypass -Command \"$ErrorActionPreference = 'Stop'; " +
      'Add-AppxPackage -Path $env:NUDGE_PACKAGE -AllowUnsigned; ' +
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

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X'))
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16));
    if (entity.startsWith('#')) return String.fromCodePoint(Number(entity.slice(1)));
    return ENTITIES[entity] ?? whole;
  });
}

type Element = { tag: string; attributes: Map<string, string> };

// An app manifest is plain XML: no DOCTYPE or custom entities, so comments, processing instructions and CDATA are the
// only places markup can hide; they are removed before reading elements.
function elements(xml: string): Element[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new InstallerError('the packaging service returned an unexpected manifest');
  const body = xml.replace(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[[\s\S]*?\]\]>/g, '');
  return [...body.matchAll(/<([\w:]+)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/g)].map(([, tag = '', rest = '']) => ({
    tag,
    attributes: new Map(
      [...rest.matchAll(/([\w:]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)].map(([, key = '', double, single]) => [
        key,
        decodeXml(double ?? single ?? ''),
      ]),
    ),
  }));
}

const fallbacks = (value: string) => [...value.matchAll(/--app-fallback-url=(\S+)/g)].map(([, url]) => url);

// The package is only served if it is unmistakably this instance's: one identity with our name and the unsigned
// publisher, the launched application falling back to this origin, and no launch parameter anywhere pointing elsewhere.
function checkManifest(xml: string, name: string, url: string): void {
  const all = elements(xml);
  const identities = all.filter(({ tag }) => tag === 'Identity');
  const identity = identities[0]?.attributes;
  if (identities.length !== 1 || identity?.get('Name') !== name || identity.get('Publisher') !== UNSIGNED_PUBLISHER) {
    throw new InstallerError('the packaging service returned a package with the wrong identity');
  }
  const apps = all.filter(({ tag, attributes }) => tag === 'Application' && attributes.get('Id') === 'App');
  const launched = fallbacks(apps[0]?.attributes.get('uap10:Parameters') ?? '');
  const everywhere = all.flatMap(({ attributes }) => [...attributes.values()].flatMap(fallbacks));
  if (apps.length !== 1 || launched.length !== 1 || everywhere.some((value) => value !== url)) {
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
