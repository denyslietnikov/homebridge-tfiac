// utils.ts

/**
 * Converts temperature from Fahrenheit to Celsius.
 * @param fahrenheit Temperature in Fahrenheit.
 * @returns Temperature in Celsius.
 */
export function fahrenheitToCelsius(fahrenheit: number | string | null | undefined): number {
  if (fahrenheit == null) {
    return NaN;
  }
  const value = typeof fahrenheit === 'string' ? parseFloat(fahrenheit) : Number(fahrenheit);
  if (isNaN(value)) {
    return NaN;
  }
  return ((value - 32) * 5) / 9;
}

/**
 * Converts temperature from Celsius to Fahrenheit.
 * @param celsius Temperature in Celsius.
 * @returns Temperature in Fahrenheit.
 */
export function celsiusToFahrenheit(celsius: number): number {
  if (typeof celsius !== 'number' || isNaN(celsius)) {
    // Handle non-numeric input gracefully
    return NaN;
  }
  return (celsius * 9) / 5 + 32;
}

/** Format a MAC address string into XX:XX:XX:XX:XX:XX */
export function formatMacAddress(mac: string | null | undefined): string {
  if (typeof mac !== 'string' || !mac.trim()) {
    return '';
  }
  const clean = mac.replace(/[^a-fA-F0-9]/g, '');
  const padded = clean.padEnd(12, '0').slice(0, 12);
  return padded.match(/.{2}/g)?.join(':') || '';
}

/** Return valid IP or empty string */
export function formatIPAddress(ip: string | null | undefined): string {
  if (typeof ip !== 'string') {
    return '';
  }
  const ipv4 = /^((25[0-5]|2[0-4]\d|[01]?\d?\d)(\.|$)){4}$/;
  const ipv6 = /^(([0-9a-fA-F]{0,4}):){2,7}([0-9a-fA-F]{0,4})$/;
  return ipv4.test(ip) || ipv6.test(ip) ? ip : '';
}

import { v5 as uuidv5 } from 'uuid';
/** Generate deterministic UUID from name and namespace */
export function generateUUID(name: string, namespace: string): string {
  return uuidv5(`${namespace}:${name}`, uuidv5.URL);
}
