/**
 * Enterprise Cookie Utility
 * Standardized way to handle auth data with security best practices.
 */

export const setCookie = (name: string, value: string, days: number = 7) => {
  try {
    const expires = new Date();
    expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
    
    // Secure: Only send over HTTPS in production
    const secure = window.location.protocol === 'https:' ? 'Secure;' : '';
    
    // SameSite=Lax for reliable auth navigation across subdomains and browser reloads
    const sameSite = 'SameSite=Lax;';
    
    document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires.toUTCString()};path=/;${secure}${sameSite}`;
  } catch (e) {
    console.warn("Failed to set cookie:", e);
  }

  // Fallback storage for incognito/strict cookie environments
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(name, value);
      window.sessionStorage.setItem(name, value);
    } catch (e) {}
  }
};

export const getCookie = (name: string): string | null => {
  try {
    const nameEQ = name + "=";
    const ca = document.cookie.split(';');
    for (let i = 0; i < ca.length; i++) {
      let c = ca[i];
      while (c.charAt(0) === ' ') c = c.substring(1, c.length);
      if (c.indexOf(nameEQ) === 0) return decodeURIComponent(c.substring(nameEQ.length, c.length));
    }
  } catch (e) {
    console.warn("Failed to read cookie:", e);
  }

  // Fallback storage for incognito/strict cookie environments
  if (typeof window !== "undefined") {
    try {
      const localVal = window.localStorage.getItem(name);
      if (localVal) return localVal;
      const sessionVal = window.sessionStorage.getItem(name);
      if (sessionVal) return sessionVal;
    } catch (e) {}
  }
  return null;
};

export const deleteCookie = (name: string) => {
  try {
    const secure = window.location.protocol === 'https:' ? 'Secure;' : '';
    document.cookie = `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT; SameSite=Strict; ${secure}`;
  } catch (e) {
    console.warn("Failed to delete cookie:", e);
  }

  // Fallback storage for incognito/strict cookie environments
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(name);
      window.sessionStorage.removeItem(name);
    } catch (e) {}
  }
};

// Typed helpers for our specific auth needs
export const cookieKeys = {
  EMPLOYEE_ID: 'jd_employee_id',
  AUTH_USER: 'jd_auth_user',
  ADMIN_TOKEN: 'jd_admin_token',
  USER_ROLE: 'jd_user_role',
} as const;
