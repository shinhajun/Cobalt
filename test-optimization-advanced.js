// Advanced test for auto-added page-load waits
// Run with: node test-optimization-advanced.js

console.log('Testing Advanced Optimization (Auto-added Waits)...\n');

const FlowOptimizer = require('./macro/optimization/FlowOptimizer');

// Simulate a macro with auto-added wait steps (like ActionAnalyzer creates)
const testMacro = {
  name: 'Test Macro with Auto Waits',
  steps: [
    // Step 1: Navigation
    {
      type: 'navigation',
      stepNumber: 1,
      timestamp: 1000,
      url: 'https://google.com',
      description: 'Navigate to Google'
    },
    // Step 2: Click
    {
      type: 'click',
      stepNumber: 2,
      timestamp: 2000,
      target: { selector: '#search' },
      description: 'Click search'
    },
    // Step 3: AUTO-ADDED WAIT (2-5 second gap detected by ActionAnalyzer)
    {
      type: 'wait',
      stepNumber: 3,
      timestamp: 2100,
      timeout: 3000, // 3 second wait
      condition: 'page-load', // Auto-added by ActionAnalyzer
      description: 'Wait for page load'
    },
    // Step 4: Click
    {
      type: 'click',
      stepNumber: 4,
      timestamp: 5100,
      target: { selector: '#result' },
      description: 'Click result'
    },
    // Step 5: AUTO-ADDED WAIT
    {
      type: 'wait',
      stepNumber: 5,
      timestamp: 5200,
      timeout: 2500, // 2.5 second wait
      condition: 'page-load',
      description: 'Wait for navigation'
    },
    // Step 6: Navigation
    {
      type: 'navigation',
      stepNumber: 6,
      timestamp: 7700,
      url: 'https://docs.google.com',
      description: 'Navigate to Docs'
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
      const isAutoWait = step.type === 'wait' && step.condition === 'page-load';
      const marker = isAutoWait ? ' 🤖 AUTO' : '';
      console.log(`  ${step.stepNumber}. [${step.type}] ${step.description}${marker}`);
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
      const isAutoWait = step.type === 'wait' && step.condition === 'page-load';
      const marker = isAutoWait ? ' 🤖 AUTO-ADDED' : '';
      console.log(`  ${step.stepNumber}. [${step.type}] ${step.description}${marker}`);
    });

    console.log('\n🔍 Verification:');

    // Count auto-added waits removed
    const autoWaitsRemoved = result.removedSteps.filter(s =>
      s.type === 'wait' && s.condition === 'page-load'
    ).length;

    console.log(`  ✓ Auto-added page-load waits removed: ${autoWaitsRemoved}/2`);

    // Verify only essential steps remain
    const hasOnlyEssentialSteps = result.optimizedSteps.every(s =>
      s.type !== 'wait' || s.condition !== 'page-load'
    );

    console.log(`  ✓ All auto waits removed: ${hasOnlyEssentialSteps ? 'YES' : 'NO'}`);

    // Calculate expected result
    const expectedSteps = 3; // nav, click, click, nav = 4, but merging might happen

    if (autoWaitsRemoved === 2 && hasOnlyEssentialSteps) {
      console.log('\n✅ Advanced test passed! All auto-added waits were removed.');
    } else {
      console.log('\n❌ Test failed!');
      console.log(`  Expected to remove 2 auto waits, removed: ${autoWaitsRemoved}`);
    }

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runTest();
