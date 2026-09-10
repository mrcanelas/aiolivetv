import { describe, expect, it } from 'vitest';
import {
  SsrfError,
  assertSafeOutboundUrl,
  isBlockedIpAddress,
} from './ssrf.js';

describe('isBlockedIpAddress', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.8',
    '192.168.1.1',
    '172.16.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '::1',
    '::ffff:127.0.0.1',
    '::ffff:7f00:1',
    'fc00::1',
    'fe80::1',
  ])('blocks %s', (ip) => {
    expect(isBlockedIpAddress(ip)).toBe(true);
  });

  it.each(['8.8.8.8', '1.1.1.1', '2001:4860:4860::8888'])('allows %s', (ip) => {
    expect(isBlockedIpAddress(ip)).toBe(false);
  });
});

describe('assertSafeOutboundUrl', () => {
  it('rejects non-http protocols', async () => {
    await expect(
      assertSafeOutboundUrl('file:///etc/passwd')
    ).rejects.toBeInstanceOf(SsrfError);
    await expect(
      assertSafeOutboundUrl('ftp://example.com/a')
    ).rejects.toBeInstanceOf(SsrfError);
  });

  it('rejects localhost and metadata hostnames without DNS', async () => {
    await expect(
      assertSafeOutboundUrl('http://localhost/guide.xml')
    ).rejects.toThrow(/Blocked hostname/);
    await expect(
      assertSafeOutboundUrl('http://metadata.google.internal/')
    ).rejects.toThrow(/Blocked hostname/);
  });

  it('rejects private, mapped and decimal loopback URLs', async () => {
    await expect(assertSafeOutboundUrl('http://2130706433/')).rejects.toThrow(
      /Blocked IP/
    );
    await expect(
      assertSafeOutboundUrl('http://[::ffff:127.0.0.1]/')
    ).rejects.toThrow(/Blocked IP/);
    await expect(
      assertSafeOutboundUrl('http://127.0.0.1/redis')
    ).rejects.toThrow(/Blocked IP/);
    await expect(
      assertSafeOutboundUrl('http://169.254.169.254/latest/meta-data/')
    ).rejects.toThrow(/Blocked IP/);
    await expect(
      assertSafeOutboundUrl('http://192.168.0.10/epg.xml')
    ).rejects.toThrow(/Blocked IP/);
  });

  it('allows a public IP literal', async () => {
    await expect(
      assertSafeOutboundUrl('https://1.1.1.1/cdn-cgi/trace')
    ).resolves.toBeInstanceOf(URL);
  });
});
