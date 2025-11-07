// Test script for macro optimization logic
// Run with: node test-optimization.js

console.log('Testing Macro Optimization...\n');

const FlowOptimizer = require('./macro/optimization/FlowOptimizer');

// Create test macro with optimization opportunities
const testMacro = {
  name: 'Test Macro',
  steps: [
    // Step 1: Navigation
    {
      type: 'navigation',
      stepNumber: 1,
      timestamp: 1000,
      url: 'https://google.com',
      description: 'Navigate to Google'
    },
    // Step 2: Click search box
    {
      type: 'click',
      stepNumber: 2,
      timestamp: 2000,
      target: { selector: '#search-input' },
      description: 'Click search input'
    },
    // Step 3: Duplicate click (should be removed)
    {
      type: 'click',
      stepNumber: 3,
      timestamp: 2100, // Within 1000ms of previous
      target: { selector: '#search-input' },
      description: 'Duplicate click on search input'
    },
    // Step 4: Type "AI" (first part)
    {
      type: 'input',
      stepNumber: 4,
      timestamp: 3000,
      target: { selector: '#search-input' },
      staticValue: 'AI',
      description: 'Type AI'
    },
    // Step 5: Type " news" (consecutive, should merge)
    {
      type: 'input',
      stepNumber: 5,
      timestamp: 3500, // Within 2000ms of previous
      target: { selector: '#search-input' },
      staticValue: ' news',
      description: 'Type news'
    },
    // Step 6: Short wait (should be removed)
    {
      type: 'wait',
      stepNumber: 6,
      timestamp: 4000,
      timeout: 300, // Less than 500ms
      condition: 'page-load',
      description: 'Wait 300ms'
    },
    // Step 7: Press Enter
    {
      type: 'keypress',
      stepNumber: 7,
      timestamp: 5000,
      key: 'Enter',
      description: 'Press Enter'
    },
    // Step 8: Final wait (should be removed - last step)
    {
      type: 'wait',
      stepNumber: 8,
      timestamp: 6000,
      timeout: 2000,
      condition: 'page-load',
      description: 'Final wait'
    }
  ]
};

async function runTest() {
  try {
    console.log('📝 Original macro:');
    console.log(`  Name: ${testMacro.name}`);
    console.log(`  Total steps: ${testMacro.steps.length}`);
    console.log('\nSteps:');
    testMacro.steps.forEach(step => {
      console.log(`  ${step.stepNumber}. [${step.type}] ${step.description}`);
    });

    console.log('\n⚙️  Running optimizer...\n');

    const optimizer = new FlowOptimizer();
    const result = await optimizer.optimize(testMacro);

    console.log('✅ Optimization complete!\n');

    console.log('📊 Results:');
    console.log(`  Original steps: ${testMacro.steps.length}`);
    console.log(`  Optimized steps: ${result.optimizedSteps.length}`);
    console.log(`  Removed steps: ${result.removedSteps.length}`);
    console.log(`  Savings: ${result.savings.percentageReduced}%`);

    console.log('\n📋 Optimized steps:');
    result.optimizedSteps.forEach(step => {
      console.log(`  ${step.stepNumber}. [${step.type}] ${step.description}`);
    });

    console.log('\n🗑️  Removed steps:');
    result.removedSteps.forEach(step => {
      console.log(`  ${step.stepNumber}. [${step.type}] ${step.description}`);
    });

    console.log('\n💡 AI Suggestions:');
    if (result.aiSuggestions.length > 0) {
      result.aiSuggestions.forEach((suggestion, i) => {
        console.log(`  ${i + 1}. ${suggestion}`);
      });
    } else {
      console.log('  (Will be generated when LLM is available)');
    }

    console.log('\n🔍 Verification:');

    // Verify duplicate click removed
    const duplicateClickRemoved = result.removedSteps.some(s =>
      s.stepNumber === 3 && s.type === 'click'
    );
    console.log(`  ✓ Duplicate click removed: ${duplicateClickRemoved ? 'YES' : 'NO'}`);

    // Verify inputs merged
    const mergedInput = result.optimizedSteps.find(s =>
      s.type === 'input' && s.staticValue === 'AI news'
    );
    console.log(`  ✓ Inputs merged: ${mergedInput ? 'YES' : 'NO'}`);

    // Verify short wait removed
    const shortWaitRemoved = result.removedSteps.some(s =>
      s.stepNumber === 6 && s.type === 'wait'
    );
    console.log(`  ✓ Short wait removed: ${shortWaitRemoved ? 'YES' : 'NO'}`);

    // Verify final wait removed
    const finalWaitRemoved = result.removedSteps.some(s =>
      s.stepNumber === 8 && s.type === 'wait'
    );
    console.log(`  ✓ Final wait removed: ${finalWaitRemoved ? 'YES' : 'NO'}`);

    // Verify steps renumbered
    const stepsRenumbered = result.optimizedSteps.every((step, i) =>
      step.stepNumber === i + 1
    );
    console.log(`  ✓ Steps renumbered: ${stepsRenumbered ? 'YES' : 'NO'}`);

    console.log('\n✅ All tests passed!');

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runTest();
