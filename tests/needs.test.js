import test from 'node:test';
import assert from 'node:assert/strict';

import { state } from '../src/state.js';
import { houseInCrisis, needsOf, restoreNeed } from '../src/residents.js';

test('home HP can enter crisis and purchases restore it safely', () => {
  state.needs = {};
  const needs = needsOf('needs_test_house');
  assert.equal(houseInCrisis('needs_test_house'), false);

  needs.hunger = 0;
  assert.equal(houseInCrisis('needs_test_house'), true);
  assert.equal(restoreNeed('needs_test_house', 'hunger', 24), 24);
  assert.equal(houseInCrisis('needs_test_house'), false);

  assert.equal(restoreNeed('needs_test_house', 'hunger', 1000), 100);
  assert.equal(restoreNeed('needs_test_house', 'hunger', -1000), 0);
});
