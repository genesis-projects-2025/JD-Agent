/**
 * Enterprise Cookie Utility
 * Standardized way to handle auth data with security best practices.
 **/

export const setCookie = (name: string, value: string, days: number = 7) => {
  const expires = new Date();
  expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
  
  // Secure: Only send over HTTPS in production
  const secure = window.location.protocol === 'https:' ? 'Secure;' : '';
  
  // SameSite=Strict for CSRF protection
  const sameSite = 'SameSite=Strict;';
  
  document.cookie = `${name}=${encodeURIComponent(value)};expires=${expires.toUTCString()};path=/;${secure}${sameSite}`;
};

export const getCookie = (name: string): string | null => {
  const nameEQ = name + "=";
  const ca = document.cookie.split(';');
  for (let i = 0; i < ca.length; i++) {
    let c = ca[i];
    while (c.charAt(0) === ' ') c = c.substring(1, c.length);
    if (c.indexOf(nameEQ) === 0) return decodeURIComponent(c.substring(nameEQ.length, c.length));
  }
  return null;
};

export const deleteCookie = (name: string) => {
  document.cookie = `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;`;
};

// Typed helpers for our specific auth needs
export const cookieKeys = {
  EMPLOYEE_ID: 'jd_employee_id',
  AUTH_USER: 'jd_auth_user',
  ADMIN_TOKEN: 'jd_admin_token',
  USER_ROLE: 'jd_user_role',
} as const;
