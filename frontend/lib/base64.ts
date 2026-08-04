/**
 * Safe Base64 encoding/decoding utilities for both Client (Browser) and Server (SSR/Node) contexts.
 * Prevents "ReferenceError: btoa is not defined" or "atob is not defined" during Server-Side Rendering
 * and prevents DOMExceptions ("Failed to execute 'atob' on 'Window'") when decoding unencoded strings.
 */

export function safeBtoa(str: string | null | undefined): string {
  if (!str) return "";
  try {
    if (typeof window !== "undefined" && typeof window.btoa === "function") {
      return window.btoa(str);
    }
    return Buffer.from(str).toString("base64");
  } catch (_e) {
    return str;
  }
}

export function safeAtob(str: string | null | undefined): string {
  if (!str) return "";

  // If string is already a raw employee code (e.g. DIR05, ZE0378, E6679, C0014), return as-is
  if (/^[A-Z]{1,4}\d{2,6}$/i.test(str)) {
    return str;
  }

  try {
    if (typeof window !== "undefined" && typeof window.atob === "function") {
      const decoded = window.atob(str);
      // Ensure decoded string is valid printable ASCII/text; if garbled binary, return original str
      if (decoded && /^[\x20-\x7E\s\w-]+$/.test(decoded)) {
        return decoded;
      }
      return decoded || str;
    }
    const bufDecoded = Buffer.from(str, "base64").toString("utf-8");
    return bufDecoded || str;
  } catch (_e) {
    // If atob throws InvalidCharacterError on unencoded input, safely return original string!
    return str;
  }
}
