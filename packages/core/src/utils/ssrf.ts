import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export class SsrfError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfError';
  }
}

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
  'metadata.internal',
  'kubernetes.default',
  'kubernetes.default.svc',
]);

function inCidr(ipInt: number, cidr: string): boolean {
  const [base, bits] = cidr.split('/');
  const prefix = Number(bits);
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (ipv4ToInt(base) & mask);
}

export function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map((part) => Number(part));
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    throw new SsrfError(`Invalid IPv4 address: ${ip}`);
  }
  return (
    ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
  );
}

const IPV4_BLOCKED_CIDRS = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
];

export function isBlockedIpv4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  return IPV4_BLOCKED_CIDRS.some((cidr) => inCidr(value, cidr));
}

function expandIpv6(ip: string): number[] {
  const [head, tail] = ip.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const missing = 8 - headParts.length - tailParts.length;
  const parts = [
    ...headParts,
    ...Array.from({ length: Math.max(missing, 0) }, () => '0'),
    ...tailParts,
  ];
  if (parts.length !== 8) {
    throw new SsrfError(`Invalid IPv6 address: ${ip}`);
  }
  return parts.map((part) => parseInt(part || '0', 16));
}

export function isBlockedIpv6(ip: string): boolean {
  const normalised = ip.toLowerCase();
  if (normalised.startsWith('::ffff:')) {
    const mapped = normalised.slice('::ffff:'.length);
    if (isIP(mapped) === 4) return isBlockedIpv4(mapped);
  }
  const hextets = expandIpv6(normalised);
  if (
    hextets[0] === 0 &&
    hextets[1] === 0 &&
    hextets[2] === 0 &&
    hextets[3] === 0 &&
    hextets[4] === 0 &&
    hextets[5] === 0xffff
  ) {
    const mapped = [
      (hextets[6] >> 8) & 255,
      hextets[6] & 255,
      (hextets[7] >> 8) & 255,
      hextets[7] & 255,
    ].join('.');
    return isBlockedIpv4(mapped);
  }
  if (hextets.every((part) => part === 0)) return true; // ::
  if (hextets.slice(0, 7).every((part) => part === 0) && hextets[7] === 1) {
    return true; // ::1
  }
  // Unique local fc00::/7
  if ((hextets[0] & 0xfe00) === 0xfc00) return true;
  // Link-local fe80::/10
  if ((hextets[0] & 0xffc0) === 0xfe80) return true;
  // Multicast ff00::/8
  if ((hextets[0] & 0xff00) === 0xff00) return true;
  // Documentation 2001:db8::/32
  if (hextets[0] === 0x2001 && hextets[1] === 0xdb8) return true;
  return false;
}

export function isBlockedIpAddress(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) return isBlockedIpv4(ip);
  if (version === 6) return isBlockedIpv6(ip);
  return true;
}

function isBlockedHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) return true;
  if (host.endsWith('.localhost') || host.endsWith('.local')) return true;
  return false;
}

export const MAX_SSRF_REDIRECTS = 5;

export async function assertSafeOutboundUrl(input: string | URL): Promise<URL> {
  let url: URL;
  try {
    url = input instanceof URL ? input : new URL(input);
  } catch {
    throw new SsrfError('Invalid URL');
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SsrfError(`Blocked URL protocol: ${url.protocol}`);
  }

  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (isBlockedHostname(hostname)) {
    throw new SsrfError(`Blocked hostname: ${hostname}`);
  }

  if (isIP(hostname)) {
    if (isBlockedIpAddress(hostname)) {
      throw new SsrfError(`Blocked IP address: ${hostname}`);
    }
    return url;
  }

  let records: Array<{ address: string }>;
  try {
    records = await lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new SsrfError(`Could not resolve hostname: ${hostname}`);
  }
  if (!records.length) {
    throw new SsrfError(`Could not resolve hostname: ${hostname}`);
  }
  for (const record of records) {
    if (isBlockedIpAddress(record.address)) {
      throw new SsrfError(
        `Hostname ${hostname} resolves to a blocked address (${record.address})`
      );
    }
  }
  return url;
}

export function isRedirectStatus(status: number): boolean {
  return [301, 302, 303, 307, 308].includes(status);
}
