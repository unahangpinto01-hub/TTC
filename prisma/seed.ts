/**
 * The original demo seed was retired when the system went into production
 * (real products, inventory, transactions, and the two-company structure now live in the database).
 * Running the old seed would corrupt live data, so it intentionally refuses.
 *
 * The full pre-migration backups live in the owner's Downloads folder
 * (ttc-demo-backup-*.json, ttc-pre-multicompany-backup-*.json).
 */
console.error("The demo seed is retired: this database holds live production data. Aborting.");
process.exit(1);
