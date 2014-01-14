"use strict";
/* -------------------------------------------------------------------
 * Require Statements << Keep in alphabetical order >>
 * ---------------------------------------------------------------- */

var Mayflower = require('./mayflower');
var program = require('commander');

/* =============================================================================
 * 
 * Commandline Interface for Mayflower
 *  
 * ========================================================================== */

program
  .option('-c, --connection <str>', 'Connection string to SQL Server Database.')
  .option('-d, --directory <dir>', 'Directory containing migration scripts.')
  .option('-f, --force', 'Forces scripts which have already been applied to be applied again.')
  .option('-s, --script [filename]', 'Specifies only a single script to be run.')
  .option('-t, --table [name]', 'Name of the Migrations history table (default: Migrations).')
  .parse(process.argsv);

var m = new Mayflower(program.connection, program.directory, program.table);

var options = {
  output: true,
  force: program.force
};

var result;
if (!program.script) {
  //migrating all scripts
  result = m.migrateAll(options);
} else {
  //running only a single script
  try {
    var script = m.getScript(program.script);
    var db = m.getDbConnection();
    result = m.migrate(db, options, script);
    db.closeSync();
    
  } catch (ex) {
    result = ex;
  }
}

if (result instanceof Error) {
  console.log(result);
  process.exit(-1);
}

process.exit(0);
