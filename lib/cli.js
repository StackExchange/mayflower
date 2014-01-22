#!/usr/bin/env node

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
  .option('-c, --connection [str]', 'Connection string to SQL Server Database.')
  .option('-d, --directory <dir>', 'Directory containing migration scripts.')
  .option('-f, --force', 'Forces scripts which have already been applied to be applied again.')
  .option('-s, --script [filename]', 'Specifies only a single script to be run.')
  .option('-t, --table [name]', 'Name of the Migrations history table (default: Migrations).')
  .option('-j, --json [filename]', 'Name of a json file where the connection string.')
  .option('-k, --key [key]', 'The key inside the json file for the connection string (dot notation).')
  .parse(process.argv);

if (!program.connection)
{
  if (!(program.json && program.key)) {
    console.error('Must provide either a connection string OR a json file and key.');
    process.exit(1);
  }
  
  try {
    var json = JSON.parse(require('fs').readFileSync(program.json, { encoding: 'utf8' }));
    var parts = program.key.split('.');
    for (var i in parts) {
      json = json[parts[i]];
    }
    program.connection = json;
  }
  catch (ex) {
    console.error('Unable to read JSON file.');
    console.error(ex.stack);
    process.exit(1);
  }
}

var m = new Mayflower(/*program.connection, program.directory, program.table*/);

var options = {
  output: true,
  force: program.force
};

var result;
if (!program.script) {
  //migrating all scripts
  result = m.migrateAll(options);
}
else {
  //running only a single script
  try {
    var script = m.getScript(program.script);
    var db = m.getDbConnection();
    result = m.migrate(db, options, script);
    db.closeSync();
    
  }
  catch (ex) {
    result = ex;
  }
}

if (result instanceof Error) {
  console.error(result.stack);
  process.exit(1);
}

process.exit(0);
