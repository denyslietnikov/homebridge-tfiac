import { fahrenheitToCelsius, celsiusToFahrenheit } from '../utils';

describe('Utils', () => {
  describe('Temperature Conversions', () => {
    it('should convert Fahrenheit to Celsius', () => {
      expect(fahrenheitToCelsius(32)).toBe(0);
      expect(fahrenheitToCelsius(212)).toBe(100);
      expect(fahrenheitToCelsius(-40)).toBe(-40);
    });

    it('should convert Celsius to Fahrenheit', () => {
      expect(celsiusToFahrenheit(0)).toBe(32);
      expect(celsiusToFahrenheit(100)).toBe(212);
      expect(celsiusToFahrenheit(-40)).toBe(-40);
    });

    it('should return NaN for invalid Fahrenheit input', () => {
      expect(isNaN(fahrenheitToCelsius(NaN))).toBe(true);
      expect(isNaN(fahrenheitToCelsius('foo' as any))).toBe(true);
      expect(isNaN(fahrenheitToCelsius(undefined as any))).toBe(true);
    });

    it('should handle fractional Fahrenheit to Celsius conversion', () => {
      expect(fahrenheitToCelsius(98.6)).toBeCloseTo(37, 1);
    });

    it('should return NaN for invalid Celsius input', () => {
      expect(isNaN(celsiusToFahrenheit(NaN))).toBe(true);
      expect(isNaN(celsiusToFahrenheit('bar' as any))).toBe(true);
      expect(isNaN(celsiusToFahrenheit(null as any))).toBe(true);
    });

    it('should handle fractional Celsius to Fahrenheit conversion', () => {
      expect(celsiusToFahrenheit(37)).toBeCloseTo(98.6, 1);
    });
  });

  // Add more tests for other utils if needed
});
