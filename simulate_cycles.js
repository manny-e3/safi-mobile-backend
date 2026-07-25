const mysql = require('mysql2/promise');
const crypto = require('crypto');

async function main() {
  const connection = await mysql.createConnection({
    host: '',
    port: '',
    database: '',
    user: '',
    password: ''
  });

  const userId = '';

  try {
    console.log('1. Checking user in core_banking_users...');
    const [users] = await connection.execute(
      'SELECT id, email, name FROM core_banking_users WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      console.error(`User with ID ${userId} not found!`);
      return;
    }
    const user = users[0];
    console.log('Found User:', user);

    console.log('2. Checking core_banking_wallets...');
    const [wallets] = await connection.execute(
      'SELECT id, accountNumber, balance FROM core_banking_wallets WHERE userId = ?',
      [userId]
    );

    if (wallets.length === 0) {
      console.error(`No wallet found for user ${userId}`);
      return;
    }
    const wallet = wallets[0];
    console.log('Found Wallet:', wallet);

    const accountNumber = wallet.accountNumber;

    // 3. Fund the account (Set balance to ₦3,000,000 in kobo = 300,000,000)
    console.log('3. Funding account to ₦3,000,000 (300,000,000 kobo)...');
    await connection.execute(
      'UPDATE core_banking_wallets SET balance = ? WHERE id = ?',
      ['300000000', wallet.id]
    );
    console.log('Wallet funded successfully!');

    // 4. Create/update SAFI configuration
    console.log('4. Setting up SAFI config...');
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 29); // 30 days from now

    // Check if config exists
    const [configs] = await connection.execute(
      'SELECT id FROM safi_configs WHERE accountNumber = ?',
      [accountNumber]
    );

    const incomeVal = '200000000'; // ₦2,000,000 in kobo
    const protectedSumVal = '109650000'; // ₦1,096,500 in kobo
    const baselineBalanceVal = '300000000'; // ₦3,000,000 in kobo

    if (configs.length > 0) {
      console.log('Updating existing SAFI config...');
      await connection.execute(
        `UPDATE safi_configs SET 
          income = ?, 
          protectedSum = ?, 
          baselineBalance = ?, 
          governanceMode = 'flexible', 
          frequency = 'monthly', 
          expiresAt = ?, 
          cardBehaviour = 'buffer', 
          bufferAmount = '1000000', 
          remainingBuffer = '1000000', 
          isPaused = 0, 
          overrideActive = 0 
         WHERE accountNumber = ?`,
        [incomeVal, protectedSumVal, baselineBalanceVal, expiresAt, accountNumber]
      );
    } else {
      console.log('Inserting new SAFI config...');
      const configId = crypto.randomUUID();
      await connection.execute(
        `INSERT INTO safi_configs 
          (id, accountNumber, income, protectedSum, baselineBalance, governanceMode, frequency, expiresAt, cardBehaviour, bufferAmount, remainingBuffer, isPaused, overrideActive, createdAt, updatedAt)
         VALUES 
          (?, ?, ?, ?, ?, 'flexible', 'monthly', ?, 'buffer', '1000000', '1000000', 0, 0, NOW(), NOW())`,
        [configId, accountNumber, incomeVal, protectedSumVal, baselineBalanceVal, expiresAt]
      );
    }
    console.log('SAFI config set up successfully!');

    // 5. Seed multiple completed cycles
    console.log('5. Deleting old cycles for this account to avoid duplicates...');
    await connection.execute(
      'DELETE FROM safi_cycles WHERE accountNumber = ?',
      [accountNumber]
    );

    console.log('6. Seeding completed past cycles...');

    // Cycle 1: June 2026 (Outcome: returned, 100% compliance)
    const cycle1Id = crypto.randomUUID();
    const cycle1Start = new Date('2026-05-22T00:00:00.000Z');
    const cycle1End = new Date('2026-06-22T23:59:59.000Z');
    await connection.execute(
      `INSERT INTO safi_cycles 
        (id, accountNumber, startDate, endDate, income, protectedSum, allocation, netAmount, complianceScore, outcome, overrideCount, bufferUsed, createdAt, updatedAt)
       VALUES 
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        cycle1Id,
        accountNumber,
        cycle1Start,
        cycle1End,
        '200000000', // 2M income
        '110000000', // 1.1M protected
        '90000000',  // 900k allocation
        '12000000',  // 120k remaining
        100,         // score
        'returned',
        0,           // overrides
        '0'          // buffer used
      ]
    );

    // Cycle 2: May 2026 (Outcome: over_budget, 72% compliance)
    const cycle2Id = crypto.randomUUID();
    const cycle2Start = new Date('2026-04-22T00:00:00.000Z');
    const cycle2End = new Date('2026-05-22T23:59:59.000Z');
    await connection.execute(
      `INSERT INTO safi_cycles 
        (id, accountNumber, startDate, endDate, income, protectedSum, allocation, netAmount, complianceScore, outcome, overrideCount, bufferUsed, createdAt, updatedAt)
       VALUES 
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        cycle2Id,
        accountNumber,
        cycle2Start,
        cycle2End,
        '200000000',
        '110000000',
        '90000000',
        '-4500000', // 45k over budget
        72,
        'over_budget',
        1,         // 1 override
        '1000000'  // 10k buffer used
      ]
    );

    // Cycle 3: April 2026 (Outcome: returned, 85% compliance)
    const cycle3Id = crypto.randomUUID();
    const cycle3Start = new Date('2026-03-22T00:00:00.000Z');
    const cycle3End = new Date('2026-04-22T23:59:59.000Z');
    await connection.execute(
      `INSERT INTO safi_cycles 
        (id, accountNumber, startDate, endDate, income, protectedSum, allocation, netAmount, complianceScore, outcome, overrideCount, bufferUsed, createdAt, updatedAt)
       VALUES 
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        cycle3Id,
        accountNumber,
        cycle3Start,
        cycle3End,
        '200000000',
        '110000000',
        '90000000',
        '0', // exact completion
        85,
        'exact',
        0,
        '0'
      ]
    );

    console.log('Successfully seeded past cycles!');

  } catch (error) {
    console.error('Error during simulation query:', error);
  } finally {
    await connection.end();
  }
}

main();
