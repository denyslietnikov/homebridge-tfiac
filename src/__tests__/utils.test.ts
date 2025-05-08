// utils.test.ts

import { describe, it, expect } from 'vitest';
import { fahrenheitToCelsius, celsiusToFahrenheit, formatMacAddress, formatIPAddress, generateUUID } from '../utils';

describe("Utils", () => {
  describe("Temperature Conversions", () => {
    it("should convert Fahrenheit to Celsius", () => {
      expect(fahrenheitToCelsius(32)).toBe(0);
      expect(fahrenheitToCelsius(212)).toBe(100);
      expect(fahrenheitToCelsius(-40)).toBe(-40);
    });

    it("should convert Celsius to Fahrenheit", () => {
      expect(celsiusToFahrenheit(0)).toBe(32);
      expect(celsiusToFahrenheit(100)).toBe(212);
      expect(celsiusToFahrenheit(-40)).toBe(-40);
    });

    it("should return NaN for invalid Fahrenheit input", () => {
      expect(isNaN(fahrenheitToCelsius(NaN))).toBe(true);
      expect(isNaN(fahrenheitToCelsius('foo' as any))).toBe(true);
      expect(isNaN(fahrenheitToCelsius(undefined as any))).toBe(true);
    });

    it("should handle fractional Fahrenheit to Celsius conversion", () => {
      expect(fahrenheitToCelsius(98.6)).toBeCloseTo(37, 1);
    });
  });

  describe('MAC Address Formatting', () => {
    it('should properly format various MAC address inputs', () => {
      expect(formatMacAddress('001122334455')).toBe('00:11:22:33:44:55');
      expect(formatMacAddress('00-11-22-33-44-55')).toBe('00:11:22:33:44:55');
      expect(formatMacAddress('AA:BB:CC:DD:EE:FF')).toBe('AA:BB:CC:DD:EE:FF');
    });

    it('should pad incomplete MAC addresses with zeros', () => {
      expect(formatMacAddress('112233')).toBe('11:22:33:00:00:00');
    });

    it('should return empty string for invalid input', () => {
      expect(formatMacAddress('')).toBe('');
      expect(formatMacAddress(null as any)).toBe('');
      expect(formatMacAddress(undefined as any)).toBe('');
    });
  });

  describe('IP Address Formatting', () => {
    it('should accept valid IPv4 and IPv6 addresses', () => {
      expect(formatIPAddress('192.168.1.1')).toBe('192.168.1.1');
      expect(formatIPAddress('::1')).toBe('::1');
    });

    it('should reject invalid IP addresses', () => {
      expect(formatIPAddress('256.256.256.256')).toBe('');
      expect(formatIPAddress('not.an.ip')).toBe('');
      expect(formatIPAddress(null as any)).toBe('');
    });
  });

  describe('UUID Generation', () => {
    it('should generate deterministic UUIDs based on inputs', () => {
      const id1 = generateUUID('device1', 'namespaceA');
      const id2 = generateUUID('device1', 'namespaceA');
      const id3 = generateUUID('device2', 'namespaceA');
      expect(id1).toBe(id2);
      expect(id1).not.toBe(id3);
      expect(id1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('should handle empty or missing inputs', () => {
      const empty1 = generateUUID('', '');
      const empty2 = generateUUID('', '');
      expect(empty1).toBe(empty2);
      expect(empty1).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
  });
});