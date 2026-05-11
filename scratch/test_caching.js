const cacheDb = require('../cacheDb');
const assert = require('assert');

async function runTest() {
    console.log('Testing CacheDb...');
    
    const testEventId = 999999;
    const testData = { total: 1234, history: [{ date: '2024-05-11', count: 100 }] };
    
    console.log('1. Setting data in SQLite...');
    cacheDb.setEvent(testEventId, testData.total, testData.history);
    
    console.log('2. Retrieving data from SQLite...');
    const result = cacheDb.getEvent(testEventId);
    
    assert.strictEqual(result.total, testData.total, 'Total count mismatch');
    assert.deepStrictEqual(result.history, testData.history, 'History mismatch');
    
    console.log('3. Updating data in SQLite...');
    const updatedTotal = 5678;
    cacheDb.setEvent(testEventId, updatedTotal, testData.history);
    const updatedResult = cacheDb.getEvent(testEventId);
    assert.strictEqual(updatedResult.total, updatedTotal, 'Updated total mismatch');
    
    console.log('✅ SQLite CacheDb tests passed!');
    cacheDb.close();
}

runTest().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
});
