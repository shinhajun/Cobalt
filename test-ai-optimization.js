// Test AI-powered optimization with actual LLM
// Run with: node test-ai-optimization.js

console.log('Testing AI-Powered Macro Optimization...\n');

const FlowOptimizer = require('./macro/optimization/FlowOptimizer');

// Create a realistic test macro with obvious redundancies for AI to catch
const testMacro = {
  name: 'Search and Click Test',
  steps: [
    // Step 1: Navigate to Google
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
      target: {
        selector: '#search-input',
        description: 'Search box'
      },
      description: 'Click search box'
    },
    // Step 3: REDUNDANT - Click search box again (AI should catch this)
    {
      type: 'click',
      stepNumber: 3,
      timestamp: 2200,
      target: {
        selector: '#search-input',
        description: 'Search box'
      },
      description: 'Click search box again'
    },
    // Step 4: Type search query
    {
      type: 'input',
      stepNumber: 4,
      timestamp: 3000,
      target: {
        selector: '#search-input',
        description: 'Search box'
      },
      staticValue: 'AI automation',
      description: 'Type search query'
    },
    // Step 5: UNNECESSARY WAIT (AI should catch this)
    {
      type: 'wait',
      stepNumber: 5,
      timestamp: 3100,
      timeout: 3000,
      condition: 'page-load',
      description: 'Wait for suggestions'
    },
    // Step 6: Press Enter
    {
      type: 'keypress',
      stepNumber: 6,
      timestamp: 6200,
      key: 'Enter',
      description: 'Press Enter to search'
    },
    // Step 7: ANOTHER UNNECESSARY WAIT (AI should catch this)
    {
      type: 'wait',
      stepNumber: 7,
      timestamp: 6300,
      timeout: 2000,
      condition: 'page-load',
      description: 'Wait for results'
    },
    // Step 8: Click first result
    {
      type: 'click',
      stepNumber: 8,
      timestamp: 8400,
      target: {
        selector: '.result-item:first-child',
        description: 'First search result'
      },
      description: 'Click first result'
    }
  ]
};

async function runTest() {
  try {
    console.log('📝 Original macro:');
    console.log(`  Name: ${testMacro.name}`);
    console.log(`  Total steps: ${testMacro.steps.length}\n`);

    console.log('Steps:');
    testMacro.steps.forEach(step => {
      const isRedundant = [3, 5, 7].includes(step.stepNumber);
      const marker = isRedundant ? ' ⚠️ REDUNDANT?' : '';
      console.log(`  ${step.stepNumber}. [${step.type}] ${step.description}${marker}`);
    });

    console.log('\n⚙️  Running AI-powered optimizer...\n');
    console.log('This will:');
    console.log('  1. Send workflow to AI for analysis');
    console.log('  2. AI identifies redundant/unnecessary steps');
    console.log('  3. Remove AI-identified steps');
    console.log('  4. Apply rule-based optimizations');
    console.log('  5. Renumber and return optimized workflow\n');

    const optimizer = new FlowOptimizer();
    const result = await optimizer.optimize(testMacro);

    console.log('✅ Optimization complete!\n');

    console.log('📊 Results:');
    console.log(`  Original steps: ${testMacro.steps.length}`);
    console.log(`  Optimized steps: ${result.optimizedSteps.length}`);
    console.log(`  Removed steps: ${result.removedSteps.length}`);
    console.log(`  Savings: ${result.savings.percentageReduced}%\n`);

    console.log('🤖 AI Analysis:');
    if (result.aiRemovals && result.aiRemovals.length > 0) {
      console.log(`  AI identified ${result.aiRemovals.length} steps to remove: [${result.aiRemovals.join(', ')}]`);
    } else {
      console.log('  AI did not identify any steps to remove (or AI analysis failed)');
    }

    if (result.aiSuggestions && result.aiSuggestions.length > 0) {
      console.log('  AI suggestions:');
      result.aiSuggestions.forEach((suggestion, i) => {
        console.log(`    ${i + 1}. ${suggestion}`);
      });
    }

    console.log('\n📋 Optimized workflow:');
    result.optimizedSteps.forEach(step => {
      console.log(`  ${step.stepNumber}. [${step.type}] ${step.description}`);
    });

    console.log('\n🗑️  Removed steps:');
    result.removedSteps.forEach(step => {
      const wasAIRemoval = result.aiRemovals && result.aiRemovals.includes(step.stepNumber);
      const marker = wasAIRemoval ? ' 🤖 AI' : ' 🔧 RULE';
      console.log(`  ${step.stepNumber}. [${step.type}] ${step.description}${marker}`);
    });

    console.log('\n🔍 Verification:');

    // Check if AI removed the redundant click
    const redundantClickRemoved = result.removedSteps.some(s =>
      s.stepNumber === 3 && s.type === 'click'
    );
    console.log(`  ✓ Redundant click (step 3) removed: ${redundantClickRemoved ? 'YES' : 'NO'}`);

    // Check if AI or rules removed wait steps
    const waitsRemoved = result.removedSteps.filter(s => s.type === 'wait').length;
    console.log(`  ✓ Wait steps removed: ${waitsRemoved}/2`);

    // Check if AI analysis ran
    const aiRan = result.aiRemovals !== undefined && result.aiRemovals !== null;
    console.log(`  ✓ AI analysis executed: ${aiRan ? 'YES' : 'NO'}`);

    // Check expected outcome
    const expectedOptimized = 5; // Should be: nav, click, input, keypress, click
    const isOptimal = result.optimizedSteps.length === expectedOptimized;
    console.log(`  ✓ Optimal result (${expectedOptimized} steps): ${isOptimal ? 'YES' : 'NO'}`);

    if (redundantClickRemoved && waitsRemoved === 2 && aiRan && isOptimal) {
      console.log('\n✅ AI-powered optimization test PASSED!');
      console.log('   AI successfully analyzed and removed unnecessary steps.');
    } else {
      console.log('\n⚠️  Test completed with warnings:');
      if (!aiRan) {
        console.log('   - AI analysis may have failed (check LLM configuration)');
        console.log('   - Optimization fell back to rule-based only');
      }
      if (!isOptimal) {
        console.log(`   - Expected ${expectedOptimized} steps, got ${result.optimizedSteps.length}`);
      }
    }

  } catch (error) {
    console.error('\n❌ Test failed with error:', error.message);
    console.error('\nStack trace:');
    console.error(error.stack);
    process.exit(1);
  }
}

runTest();
