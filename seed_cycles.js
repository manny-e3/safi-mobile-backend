/**
 * seed_cycles.js
 * Seeds 3–5 completed past cycles for every active SAFI config account.
 * Run with: node seed_cycles.js
 */
const mysql = require('mysql2/promise');
const crypto = require('crypto');

const DB = {
  host: 'localhost',
  port: 3306,
  database: 'safi',
  user: 'root',
  password: ''
};

// Possible cycle outcomes and their compliance score ranges
const OUTCOMES = [
  { outcome: 'returned',    scoreMin: 88, scoreMax: 100, overrides: 0, budgetMultiplier:  0.08 },
  { outcome: 'returned',    scoreMin: 80, scoreMax: 92,  overrides: 0, budgetMultiplier:  0.04 },
  { outcome: 'exact',       scoreMin: 82, scoreMax: 88,  overrides: 0, budgetMultiplier:  0    },
  { outcome: 'over_budget', scoreMin: 60, scoreMax: 78,  overrides: 1, budgetMultiplier: -0.05 },
  { outcome: 'returned',    scoreMin: 85, scoreMax: 95,  overrides: 0, budgetMultiplier:  0.06 },
];

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function cycleDates(monthsAgo) {
  const end = new Date();
  end.setMonth(end.getMonth() - monthsAgo);
  end.setDate(22);
  end.setHours(23, 59, 59, 0);

  const start = new Date(end);
  start.setMonth(start.getMonth() - 1);
  start.setDate(22);
  start.setHours(0, 0, 0, 0);

  return { start, end };
}

async function main() {
  const conn = await mysql.createConnection(DB);
  console.log('Connected to MySQL database:', DB.database);

  try {
    // Fetch all active SAFI configs
    const [configs] = await conn.execute(
      `SELECT sc.accountNumber, sc.income, sc.protectedSum
       FROM safi_configs sc
       WHERE sc.isPaused = 0`
    );

    console.log(`Found ${configs.length} active SAFI configs. Seeding cycles...\n`);

    let totalInserted = 0;

    for (const config of configs) {
      const { accountNumber, income, protectedSum } = config;
      const incomeN = BigInt(income);
      const protectedN = BigInt(protectedSum);
      const allocationN = incomeN - protectedN;

      // Delete any existing cycles for this account first
      await conn.execute('DELETE FROM safi_cycles WHERE accountNumber = ?', [accountNumber]);

      // Seed 5 past monthly cycles (5 months ago → 1 month ago)
      for (let i = 5; i >= 1; i--) {
        const template = OUTCOMES[(5 - i) % OUTCOMES.length];
        const { start, end } = cycleDates(i);

        const score = randInt(template.scoreMin, template.scoreMax);
        const budgetDelta = BigInt(Math.round(Number(allocationN) * template.budgetMultiplier));
        const netAmount = allocationN + budgetDelta;

        const bufferUsed = template.outcome === 'over_budget'
          ? String(Math.round(Number(protectedN) * 0.009))
          : '0';

        const id = crypto.randomUUID();

        await conn.execute(
          `INSERT INTO safi_cycles
            (id, accountNumber, startDate, endDate, income, protectedSum, allocation, netAmount,
             complianceScore, outcome, overrideCount, bufferUsed, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
          [
            id,
            accountNumber,
            start,
            end,
            String(incomeN),
            String(protectedN),
            String(allocationN),
            String(netAmount),
            score,
            template.outcome,
            template.overrides,
            bufferUsed
          ]
        );
        totalInserted++;
      }

      console.log(`  ✓ ${accountNumber} — 5 cycles seeded`);
    }

    console.log(`\nDone! Inserted ${totalInserted} cycles across ${configs.length} accounts.`);

    // Print summary of what the dashboard will now compute
    const [avgScore] = await conn.execute('SELECT AVG(complianceScore) as avg FROM safi_cycles');
    const [countAll] = await conn.execute('SELECT COUNT(*) as total FROM safi_cycles');
    const [countOver] = await conn.execute("SELECT COUNT(*) as overCount FROM safi_cycles WHERE outcome = 'over_budget'");

    const avg = parseFloat(avgScore[0].avg).toFixed(1);
    const total = countAll[0].total;
    const over = countOver[0].overCount;
    const retention = (((total - over) / total) * 100).toFixed(1);

    console.log('\n--- Dashboard Preview ---');
    console.log(`  Rule Compliance Index : ${avg}`);
    console.log(`  Deposit Retention     : ${retention}%`);
    console.log(`  Total cycles in DB    : ${total}`);
  } catch (err) {
    console.error('Error seeding cycles:', err);
  } finally {
    await conn.end();
    console.log('\nConnection closed.');
  }
}

main();
