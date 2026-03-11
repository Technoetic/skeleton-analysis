#!/usr/bin/env node
/**
 * Unit tests for PredictionModel static methods
 * Test: calcAirDensity and calcDewPoint
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

// Mock browser globals before loading the class
global.window = {};
global.document = {
  documentElement: {
    getAttribute: () => 'dark'
  }
};

// Load PredictionModel.js using eval
const predictionModelPath = path.join(__dirname, '../../web/src/js/PredictionModel.js');
const predictionModelCode = fs.readFileSync(predictionModelPath, 'utf-8');
const vm = require('vm');
vm.runInThisContext(predictionModelCode);

// Test suite
const tests = [];

// Test 1: calcAirDensity at standard conditions (0°C, 50% humidity, 1013.25 hPa)
tests.push({
  name: 'calcAirDensity: Standard conditions (0°C, 50% RH, 1013.25 hPa)',
  fn: () => {
    const airTemp = 0;
    const humidity = 50;
    const pressure = 1013.25;
    const result = PredictionModel.calcAirDensity(airTemp, humidity, pressure);

    // Expected: ~1.29 kg/m³
    const expected = 1.29;
    const tolerance = 0.01;

    assert(
      Math.abs(result - expected) <= tolerance,
      `Expected ~${expected} kg/m³, got ${result.toFixed(4)} kg/m³`
    );

    return { result, expected, tolerance };
  }
});

// Test 2: calcDewPoint at 20°C, 50% humidity
tests.push({
  name: 'calcDewPoint: 20°C, 50% RH',
  fn: () => {
    const airTemp = 20;
    const humidity = 50;
    const result = PredictionModel.calcDewPoint(airTemp, humidity);

    // Expected: ~9.3°C
    const expected = 9.3;
    const tolerance = 0.3;

    assert(
      Math.abs(result - expected) <= tolerance,
      `Expected ~${expected}°C, got ${result.toFixed(2)}°C`
    );

    return { result, expected, tolerance };
  }
});

// Test 3: calcAirDensity with extreme humidity
tests.push({
  name: 'calcAirDensity: 0°C, 100% humidity, 1013.25 hPa',
  fn: () => {
    const airTemp = 0;
    const humidity = 100;
    const pressure = 1013.25;
    const result = PredictionModel.calcAirDensity(airTemp, humidity, pressure);

    // Higher humidity = more water vapor = slightly LOWER density (water vapor is lighter than dry air)
    assert(
      result > 1.28 && result < 1.30,
      `Expected density ~1.289 kg/m³ for 100% humidity at 0°C, got ${result.toFixed(4)} kg/m³`
    );

    return { result };
  }
});

// Test 4: calcDewPoint at high temperature and low humidity
tests.push({
  name: 'calcDewPoint: 30°C, 20% RH',
  fn: () => {
    const airTemp = 30;
    const humidity = 20;
    const result = PredictionModel.calcDewPoint(airTemp, humidity);

    // Should be much lower than air temperature
    assert(
      result < airTemp,
      `Dew point should be lower than air temp; got ${result.toFixed(2)}°C vs ${airTemp}°C`
    );

    return { result };
  }
});

// Test 5: calcDewPoint at 100% humidity should equal air temperature
tests.push({
  name: 'calcDewPoint: At 100% humidity, dew point should equal air temp',
  fn: () => {
    const airTemp = 15;
    const humidity = 100;
    const result = PredictionModel.calcDewPoint(airTemp, humidity);

    // At 100% RH, dew point = air temperature
    const tolerance = 0.01;
    assert(
      Math.abs(result - airTemp) <= tolerance,
      `At 100% RH, expected dew point ≈ ${airTemp}°C, got ${result.toFixed(2)}°C`
    );

    return { result, airTemp };
  }
});

// Test 6: calcAirDensity - higher pressure should increase density
tests.push({
  name: 'calcAirDensity: Higher pressure increases density',
  fn: () => {
    const airTemp = 0;
    const humidity = 50;

    const lowPressure = 1000;
    const highPressure = 1020;

    const result1 = PredictionModel.calcAirDensity(airTemp, humidity, lowPressure);
    const result2 = PredictionModel.calcAirDensity(airTemp, humidity, highPressure);

    assert(
      result2 > result1,
      `Higher pressure should increase density; ${result1.toFixed(4)} vs ${result2.toFixed(4)}`
    );

    return { lowPressureDensity: result1, highPressureDensity: result2 };
  }
});

// Run all tests
console.log('========================================');
console.log('PredictionModel Unit Tests');
console.log('========================================\n');

let passed = 0;
let failed = 0;

tests.forEach((test, index) => {
  try {
    const testNumber = index + 1;
    console.log(`[${testNumber}] ${test.name}`);
    const result = test.fn();
    console.log('    ✓ PASS');
    if (result && Object.keys(result).length > 0) {
      Object.entries(result).forEach(([key, value]) => {
        if (typeof value === 'number') {
          console.log(`       ${key}: ${value.toFixed(4)}`);
        } else {
          console.log(`       ${key}: ${value}`);
        }
      });
    }
    passed++;
  } catch (error) {
    console.log(`    ✗ FAIL: ${error.message}`);
    failed++;
  }
  console.log();
});

// Summary
console.log('========================================');
console.log(`Results: ${passed} passed, ${failed} failed (${passed + failed} total)`);
console.log('========================================');

process.exit(failed > 0 ? 1 : 0);
