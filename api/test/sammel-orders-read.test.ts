import assert from 'node:assert/strict';
import { getSammelOrders } from '../lib/sammelbestellung-list';
import { dbTest } from './fixtures/database';
import { recordQueries } from './fixtures/queries';
import { sammelCampaign, sammelOrder, seedSammel } from './fixtures/sammel';

dbTest('the orders of a campaign are read by six statements and keep their own rows', async (t) => {
  await seedSammel(
    [sammelCampaign(), sammelCampaign({ id: '9', title: 'Herbst' })],
    [
      sammelOrder({ id: '2', email: 'a@example.test', items: [{ ...itemOf(1) }] }),
      sammelOrder({
        id: '3',
        email: 'b@example.test',
        items: [itemOf(2), { ...itemOf(3), reference: '00124' }],
      }),
      sammelOrder({ id: '4', email: 'c@example.test', items: [itemOf(4)] }),
      sammelOrder({ id: '5', campaignId: '9', email: 'd@example.test', items: [itemOf(5)] }),
    ]
  );
  const queries = recordQueries(t);

  const orders = await getSammelOrders('1');

  assert.deepEqual(
    orders.map((order) => [order.id, order.items.map((item) => item.quantity)]),
    [
      ['2', [1]],
      ['3', [2, 3]],
      ['4', [4]],
    ]
  );
  // Orders, articles, payments, addresses, history and the check of the versions
  assert.equal(queries.statements.length, 6);
  assert.ok(queries.statements.every((statement) => !/\(select/i.test(statement)));
});

dbTest('more orders than fit one statement are read completely and in order', async (t) => {
  const count = 1003;
  await seedSammel(
    [sammelCampaign()],
    Array.from({ length: count }, (_, index) =>
      sammelOrder({
        id: String(index + 2),
        email: `person${index}@example.test`,
        items: [],
        submitted: false,
      })
    )
  );
  const queries = recordQueries(t);

  const orders = await getSammelOrders('1');

  assert.deepEqual(
    orders.map((order) => order.id),
    Array.from({ length: count }, (_, index) => String(index + 2))
  );
  // Two slices of IDs for each of the five statements by ID, plus the read of the orders
  assert.equal(queries.statements.length, 11);
});

function itemOf(quantity: number) {
  return { name: 'Kluft', reference: '00123', variant: '164', quantity };
}
