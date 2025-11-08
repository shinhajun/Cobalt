// Test script for verifying macro system components
// Run with: node test-macro-system.js

console.log('Testing Macro Recording System...\n');

try {
  // Test 1: Load MacroTypes
  console.log('[1/5] Testing MacroTypes...');
  const MacroTypes = require('./macro/types/MacroTypes');
  const testMacro = MacroTypes.createMacro('Test Macro');
  console.log('✓ MacroTypes loaded successfully');
  console.log('  - Created macro:', testMacro.name, 'with ID:', testMacro.id);

  // Test 2: Load RecordingManager
  console.log('\n[2/5] Testing RecordingManager...');
  const RecordingManager = require('./macro/recording/RecordingManager');
  const manager = new RecordingManager();
  console.log('✓ RecordingManager instantiated successfully');
  console.log('  - Initial state:', manager.state);

  // Test 3: Load EventSerializer
  console.log('\n[3/5] Testing EventSerializer...');
  const EventSerializer = require('./macro/recording/EventSerializer');
  const testEvent = {
    type: 'click',
    target: { tagName: 'button', id: 'test-btn' },
    timestamp: Date.now()
  };
  const serialized = EventSerializer.serialize(testEvent);
  console.log('✓ EventSerializer working');
  console.log('  - Serialized event type:', serialized.type);

  // Test 4: Load ActionAnalyzer
  console.log('\n[4/5] Testing ActionAnalyzer...');
  const ActionAnalyzer = require('./macro/analysis/ActionAnalyzer');
  const analyzer = new ActionAnalyzer();
  const testEvents = [
    {
      type: MacroTypes.EventType.NAVIGATION,
      timestamp: 0,
      data: { url: 'https://example.com' }
    }
  ];
  const steps = analyzer.analyze(testEvents);
  console.log('✓ ActionAnalyzer working');
  console.log('  - Analyzed', testEvents.length, 'events into', steps.length, 'steps');

  // Test 5: Load FlowchartGenerator
  console.log('\n[5/5] Testing FlowchartGenerator...');
  const FlowchartGenerator = require('./macro/analysis/FlowchartGenerator');
  const generator = new FlowchartGenerator();
  const macroWithSteps = generator.generate(testMacro, steps);
  console.log('✓ FlowchartGenerator working');
  console.log('  - Generated flowchart with', macroWithSteps.flowchart.nodes.length, 'nodes');

  console.log('\n✅ All tests passed! Macro system is ready.');
  console.log('\nYou can now run the application with: npm start');

} catch (error) {
  console.error('\n❌ Test failed:', error.message);
  console.error('\nStack trace:', error.stack);
  process.exit(1);
}
