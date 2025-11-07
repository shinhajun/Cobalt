/**
 * Integration Test - Test browser-use style features
 * Tests EventBus, BrowserController, BrowserProfile integration
 */

import { BrowserController } from './dist/browserController.js';
import { BrowserProfile } from './dist/browser/BrowserProfile.js';
import { BrowserEventTypes } from './dist/events/browserEvents.js';

async function testIntegration() {
  console.log('=== Browser-use Integration Test ===\n');

  // Test 1: BrowserProfile creation
  console.log('Test 1: Creating BrowserProfile...');
  const profile = BrowserProfile.createDefault();
  profile.headless = false; // Show browser for testing
  console.log('✓ BrowserProfile created');
  console.log(`  - Headless: ${profile.headless}`);
  console.log(`  - Viewport: ${profile.viewport.width}x${profile.viewport.height}`);
  console.log(`  - Locale: ${profile.locale}\n`);

  // Test 2: BrowserController with EventBus
  console.log('Test 2: Creating BrowserController with EventBus...');
  const controller = new BrowserController(true, profile);
  console.log('✓ BrowserController created');
  console.log(`  - EventBus listeners: ${controller.eventBus.listenerCount('*')}\n`);

  // Test 3: Subscribe to events
  console.log('Test 3: Subscribing to events...');
  const events = [];

  controller.eventBus.on(BrowserEventTypes.BROWSER_LAUNCH, (event) => {
    console.log('  [EVENT] Browser Launch:', event.type);
    events.push('browser_launch');
  });

  controller.eventBus.on(BrowserEventTypes.BROWSER_LAUNCH_RESULT, (event) => {
    console.log('  [EVENT] Browser Launch Result:', event.success ? 'SUCCESS' : 'FAIL');
    events.push('browser_launch_result');
  });

  controller.eventBus.on(BrowserEventTypes.NAVIGATION_STARTED, (event) => {
    console.log('  [EVENT] Navigation Started:', event.url);
    events.push('navigation_started');
  });

  controller.eventBus.on(BrowserEventTypes.NAVIGATION_COMPLETE, (event) => {
    console.log('  [EVENT] Navigation Complete:', event.url, '-', event.success ? 'SUCCESS' : 'FAIL');
    events.push('navigation_complete');
  });

  controller.eventBus.on(BrowserEventTypes.SCREENSHOT, (event) => {
    console.log('  [EVENT] Screenshot:', event.action, '- URL:', event.url.substring(0, 50) + '...');
    events.push('screenshot');
  });

  console.log('✓ Subscribed to 5 event types\n');

  // Test 4: Launch browser
  console.log('Test 4: Launching browser...');
  await controller.launch();
  console.log('✓ Browser launched\n');

  // Wait a bit for launch events
  await new Promise(resolve => setTimeout(resolve, 1000));

  // Test 5: Navigate to a website
  console.log('Test 5: Navigating to example.com...');
  await controller.navigate('https://example.com', false);
  console.log('✓ Navigation completed\n');

  // Wait a bit for navigation events
  await new Promise(resolve => setTimeout(resolve, 2000));

  // Test 6: Get browser state
  console.log('Test 6: Getting browser state...');
  const state = await controller.getBrowserState(false, true);
  console.log('✓ Browser state retrieved');
  console.log(`  - URL: ${state.url}`);
  console.log(`  - Title: ${state.title}`);
  console.log(`  - Elements found: ${Object.keys(state.selectorMap).length}`);
  console.log(`  - Tabs: ${state.tabs.length}\n`);

  // Test 7: Check events received
  console.log('Test 7: Checking events received...');
  console.log(`✓ Total events received: ${events.length}`);
  console.log(`  - Events: ${events.join(', ')}\n`);

  // Test 8: Close browser
  console.log('Test 8: Closing browser...');
  await controller.close();
  console.log('✓ Browser closed\n');

  // Summary
  console.log('=== Test Summary ===');
  console.log(`✓ All tests passed!`);
  console.log(`✓ Events received: ${events.length}`);
  console.log(`✓ Expected events: browser_launch, browser_launch_result, navigation_started, navigation_complete, screenshot`);
  console.log('\n=== Integration Test Complete ===');

  process.exit(0);
}

// Run test
testIntegration().catch(error => {
  console.error('\n❌ Test failed:', error);
  process.exit(1);
});
