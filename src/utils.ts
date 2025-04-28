// utils.ts

/**
 * Converts temperature from Fahrenheit to Celsius.
 * @param fahrenheit Temperature in Fahrenheit.
 * @returns Temperature in Celsius.
 */
export function fahrenheitToCelsius(fahrenheit: number): number {
  if (typeof fahrenheit !== 'number' || isNaN(fahrenheit)) {
    // Handle non-numeric input gracefully, perhaps return NaN or throw an error
    // For now, return NaN as an indicator of invalid input.
    return NaN;
  }
  return ((fahrenheit - 32) * 5) / 9;
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

// Add other utility functions if needed
