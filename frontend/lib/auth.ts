import {
  getOrCreateEmployeeId as _getOrCreate,
  getEmployeeId as _getId,
} from "./api";

/**
 * Auth helpers — delegate to the canonical cookie-aware implementation in api.ts.
 * This ensures consistent behavior: reads from cookie, falls back to generating
 * and persisting a random anonymous ID in a cookie (not UNKNOWN_USER).
 */

export function getOrCreateEmployeeId(): string {
  return _getOrCreate();
}

export function getEmployeeId(): string | null {
  return _getId();
}
