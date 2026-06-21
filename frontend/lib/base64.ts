/**
 * Safe Base64 encoding/decoding utilities for both Client (Browser) and Server (SSR/Node) contexts.
 * Prevents "ReferenceError: btoa is not defined" or "atob is not defined" during Server-Side Rendering.
 */

export function safeBtoa(str: string | null | undefined): string {
  if (!str) return "";
  if (typeof window !== "undefined" && typeof window.btoa === "function") {
    return window.btoa(str);
  }
  return Buffer.from(str).toString("base64");
}

export function safeAtob(str: string | null | undefined): string {
  if (!str) return "";
  if (typeof window !== "undefined" && typeof window.atob === "function") {
    return window.atob(str);
  }
  return Buffer.from(str, "base64").toString("binary");
}
