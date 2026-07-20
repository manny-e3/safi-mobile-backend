const mysql = require('mysql2/promise');

async function main() {
  const connection = await mysql.createConnection({
    host: '86.107.77.95',
    port: 3306,
    database: 'travaiqc_safi',
    user: 'travaiqc_safi',
    password: '$akwnVh%5;Bi&~hy'
  });

  try {
    const [rows] = await connection.execute(
      'SELECT id, type, amount, description, createdAt FROM core_banking_transactions ORDER BY createdAt DESC LIMIT 10'
    );
    console.log('Recent Transactions:', JSON.stringify(rows, null, 2));

    const [safiRows] = await connection.execute(
      'SELECT id, type, amount, reference, createdAt FROM safi_transactions ORDER BY createdAt DESC LIMIT 10'
    );
    console.log('Recent Safi Transactions:', JSON.stringify(safiRows, null, 2));

    const [safiConfigs] = await connection.execute(
      'SELECT accountNumber, income, protectedSum, baselineBalance, frequency, customDays, expiresAt FROM safi_configs LIMIT 5'
    );
    console.log('Safi Configs:', JSON.stringify(safiConfigs, null, 2));

  } catch (error) {
    console.error('Error querying DB:', error);
  } finally {
    await connection.end();
  }
}

main();
