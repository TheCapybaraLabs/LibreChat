import type { Request } from 'express';
import { removePorts } from './ports';

const req = (ip: string | undefined): Request => ({ ip }) as Request;

describe('removePorts', () => {
  describe('bare IPv4 (no port)', () => {
    test('returns a standard private IP unchanged', () => {
      expect(removePorts(req('192.168.1.1'))).toBe('192.168.1.1');
    });

    test('returns a public IP unchanged', () => {
      expect(removePorts(req('149.154.20.46'))).toBe('149.154.20.46');
    });

    test('returns loopback unchanged', () => {
      expect(removePorts(req('127.0.0.1'))).toBe('127.0.0.1');
    });
  });

  describe('IPv4 with port (the primary bug scenario)', () => {
    test('strips port from a private IP', () => {
      expect(removePorts(req('192.168.1.1:8080'))).toBe('192.168.1.1');
    });

    test('strips port from the IP in the original issue report', () => {
      expect(removePorts(req('149.154.20.46:48198'))).toBe('149.154.20.46');
    });

    test('strips a low port number', () => {
      expect(removePorts(req('10.0.0.1:80'))).toBe('10.0.0.1');
    });

    test('strips a high port number', () => {
      expect(removePorts(req('10.0.0.1:65535'))).toBe('10.0.0.1');
    });
  });

  describe('bare IPv6 (no port) — bucketed by /56 via ipKeyGenerator', () => {
    test('returns loopback bucketed', () => {
      expect(removePorts(req('::1'))).toBe('::/56');
    });

    test('returns a full address bucketed', () => {
      expect(removePorts(req('2001:db8::1'))).toBe('2001:db8::/56');
    });

    test('unwraps IPv4-mapped IPv6 to plain IPv4', () => {
      expect(removePorts(req('::ffff:192.168.1.1'))).toBe('192.168.1.1');
    });

    test('returns a fully expanded IPv6 in canonical /56 form', () => {
      expect(removePorts(req('2001:0db8:85a3:0000:0000:8a2e:0370:7334'))).toBe(
        '2001:db8:85a3::/56',
      );
    });
  });

  describe('bracketed IPv6 with port', () => {
    test('extracts loopback from brackets with port and buckets it', () => {
      expect(removePorts(req('[::1]:8080'))).toBe('::/56');
    });

    test('extracts a full address from brackets with port and buckets it', () => {
      expect(removePorts(req('[2001:db8::1]:443'))).toBe('2001:db8::/56');
    });

    test('extracts address from brackets without port and buckets it', () => {
      expect(removePorts(req('[::1]'))).toBe('::/56');
    });
  });

  describe('falsy / missing ip', () => {
    test('returns empty string when ip is undefined', () => {
      expect(removePorts(req(undefined))).toBe('');
    });

    test('returns empty string when ip is empty string', () => {
      expect(removePorts({ ip: '' } as Request)).toBe('');
    });

    test('returns empty string when req is null', () => {
      expect(removePorts(null as unknown as Request)).toBe('');
    });
  });

  describe('IPv4-mapped IPv6 with port', () => {
    test('strips port and unwraps to plain IPv4', () => {
      expect(removePorts(req('::ffff:1.2.3.4:8080'))).toBe('1.2.3.4');
    });
  });

  describe('express-rate-limit v8 heuristic guard', () => {
    test('function source contains "ipKeyGenerator" (suppresses ERR_ERL_KEY_GEN_IPV6)', () => {
      expect(removePorts.toString()).toContain('ipKeyGenerator');
    });
  });

  describe('unrecognized formats fall through unchanged', () => {
    test('returns garbage input unchanged', () => {
      expect(removePorts(req('not-an-ip'))).toBe('not-an-ip');
    });
  });
});
