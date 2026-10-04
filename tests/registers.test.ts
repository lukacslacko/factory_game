import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareValues } from '../src/registers';
test('register sorting compares counts, currency, natural IDs and timestamps', () => {
  assert.ok(compareValues('2', '10') < 0);
  assert.ok(compareValues('$1,200.00', '$50.00') > 0);
  assert.ok(compareValues('EQ-9', 'EQ-10') < 0);
  assert.ok(compareValues('D2 07:01', 'D10 07:01') < 0);
  assert.ok(compareValues('20 L', '3 L') > 0);
});
