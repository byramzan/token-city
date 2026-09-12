import { cronJobs } from 'convex/server';
import { internal } from './_generated/api.js';
const crons = cronJobs();
crons.interval('household simulation', { minutes: 1 }, internal.households.tick, {});
// Chain reconciliation is durable by design (task8 §15.2): the cursor lives in
// the database, so a redeployment or a dropped provider connection only delays
// ingestion, it never loses a deposit.
crons.interval('robinhood chain reconciliation', { minutes: 2 }, internal.chainActions.reconcileChain, {});
crons.interval('withdrawal queue', { minutes: 1 }, internal.chainActions.processWithdrawalQueue, {});
export default crons;
