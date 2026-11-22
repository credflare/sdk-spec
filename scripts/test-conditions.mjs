import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './generate.mjs';
import { OPERATORS, test as check, visible } from './conditions.mjs';

const fixture = JSON.parse(readFileSync(join(ROOT, 'fixtures/show-if-cases.json'), 'utf8'));
const spec = JSON.parse(readFileSync(join(ROOT, 'spec/requirements.json'), 'utf8'));

for (const c of fixture.conditions) {
  test(`condition: ${c.name}`, () => {
    assert.equal(check(c.condition, { form: c.form }), c.expect);
  });
}

for (const c of fixture.show_if) {
  test(`show_if: ${c.name}`, () => {
    assert.equal(visible({ key: 'q', show_if: c.show_if }, c.form), c.expect);
  });
}

test('the fixture covers every operator in the spec', () => {
  assert.deepEqual(spec.show_if.operators, OPERATORS);
  const used = new Set(fixture.conditions.map((c) => c.condition.op));
  for (const op of OPERATORS) assert.ok(used.has(op), `no case for ${op}`);
});

test('visibility uses only questions that are still shown', () => {
  const session = JSON.parse(readFileSync(join(ROOT, 'fixtures/questionnaire-session.json'), 'utf8'));
  const questions = session.data.profile.form_schema;
  const shown = (answers) => questions.filter((q) => visible(q, answers)).map((q) => q.key);
  assert.ok(!shown({ employment: 'Student' }).includes('employer'));
  assert.ok(shown({ employment: 'Employed' }).includes('employer'));
  assert.ok(shown({ employment: 'Self employed' }).includes('income'));
  assert.ok(shown({ sources: ['Salary', 'Other'] }).includes('sources_other'));
  assert.ok(!shown({}).includes('sources_other'));
});
