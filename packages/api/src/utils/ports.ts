import { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';

/**
 * Strips port suffix from req.ip and delegates to express-rate-limit's
 * ipKeyGenerator helper for IPv6-safe rate-limit keys.
 */
export function removePorts(req: Request): string {
  const raw = req?.ip ?? '';
  const stripped = stripPort(raw);
  return ipKeyGenerator(stripped);
}

function stripPort(ip: string): string {
  if (!ip) {
    return ip;
  }
  if (ip.charCodeAt(0) === 91) {
    const close = ip.indexOf(']');
    return close > 0 ? ip.slice(1, close) : ip;
  }
  const lastColon = ip.lastIndexOf(':');
  if (lastColon === -1) {
    return ip;
  }
  if (ip.indexOf('.') !== -1 && hasOnlyDigitsAfter(ip, lastColon + 1)) {
    return ip.slice(0, lastColon);
  }
  return ip;
}

function hasOnlyDigitsAfter(str: string, start: number): boolean {
  if (start >= str.length) {
    return false;
  }
  for (let i = start; i < str.length; i++) {
    const c = str.charCodeAt(i);
    if (c < 48 || c > 57) {
      return false;
    }
  }
  return true;
}
