// Test script for macro validation
// Run with: node macro/test-macro-validation.js

const path = require('path');

// Mock Electron app for testing
const mockApp = {
  getPath: (name) => {
    if (name === 'userData') {
      return path.join(__dirname, '../test-data');
    }
    return path.join(__dirname, '../test-data');
  }
};

// Replace require('electron') with mock
require.cache[require.resolve('electron')] = {
  exports: {
    app: mockApp
  }
};

const MacroStorage = require('./execution/MacroStorage');

// Test data
const validMacro = {
  id: 'macro_test_123',
  name: 'Valid Test Macro',
  description: 'A test macro',
  createdAt: Date.now(),
  updatedAt: Date.now(),
  version: '1.0',
  steps: [
    {
      type: 'navigation',
      stepNumber: 1,
      timestamp: 1000,
      url: 'https://example.com'
    },
    {
      type: 'input',
      stepNumber: 2,
      timestamp: 2000,
      target: { selector: '#input', description: 'Text input' },
      inputMode: 'static',
      staticValue: 'test value'
    }
  ],
  metadata: {
    totalSteps: 2,
    duration: 2000,
    startUrl: 'https://example.com',
    endUrl: 'https://example.com',
    browserVersion: 'Cobalt 1.0'
  }
};

const invalidMacros = [
  {
    name: 'No ID macro',
    data: { ...validMacro, id: null },
    expectedError: 'valid ID'
  },
  {
    name: 'Empty name macro',
    data: { ...validMacro, name: '' },
    expectedError: 'valid name'
  },
  {
    name: 'Short name macro',
    data: { ...validMacro, name: 'ab' },
    expectedError: 'at least 3 characters'
  },
  {
    name: 'Name with invalid chars',
    data: { ...validMacro, name: 'test/macro*' },
    expectedError: 'invalid characters'
  },
  {
    name: 'Spaces only name',
    data: { ...validMacro, name: '   ' },
    expectedError: 'empty'
  },
  {
    name: 'Prompt mode without question',
    data: {
      ...validMacro,
      steps: [
        {
          type: 'input',
          stepNumber: 1,
          timestamp: 1000,
          target: { selector: '#input', description: 'Text input' },
          inputMode: 'prompt',
          promptConfig: { question: '' }
        }
      ]
    },
    expectedError: 'Prompt mode requires a question'
  },
  {
    name: 'AI mode without prompt',
    data: {
      ...validMacro,
      steps: [
        {
          type: 'input',
          stepNumber: 1,
          timestamp: 1000,
          target: { selector: '#input', description: 'Text input' },
          inputMode: 'ai',
          aiConfig: { prompt: '' }
        }
      ]
    },
    expectedError: 'AI mode requires a prompt'
  }
];

console.log('🧪 Testing Macro Validation\n');
console.log('='.repeat(50));

// Test valid macro
console.log('\n✅ Testing VALID macro:');
try {
  const storage = new MacroStorage();
  storage.validateMacro(validMacro);
  console.log('   ✓ Valid macro passed validation');
} catch (error) {
  console.error('   ✗ Valid macro failed:', error.message);
}

// Test invalid macros
console.log('\n❌ Testing INVALID macros:\n');
let passedTests = 0;
let failedTests = 0;

invalidMacros.forEach((testCase) => {
  try {
    const storage = new MacroStorage();
    storage.validateMacro(testCase.data);
    console.log(`   ✗ ${testCase.name}: Should have failed but passed`);
    failedTests++;
  } catch (error) {
    if (error.message.includes(testCase.expectedError) ||
        error.message.toLowerCase().includes(testCase.expectedError.toLowerCase())) {
      console.log(`   ✓ ${testCase.name}: Correctly caught error`);
      console.log(`      → "${error.message}"`);
      passedTests++;
    } else {
      console.log(`   ✗ ${testCase.name}: Wrong error message`);
      console.log(`      Expected: "${testCase.expectedError}"`);
      console.log(`      Got: "${error.message}"`);
      failedTests++;
    }
  }
});

console.log('\n' + '='.repeat(50));
console.log(`\n📊 Results: ${passedTests} passed, ${failedTests} failed`);

if (failedTests === 0) {
  console.log('✅ All validation tests passed!\n');
  process.exit(0);
} else {
  console.log('❌ Some tests failed\n');
  process.exit(1);
}
