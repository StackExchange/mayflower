"use strict";
/* -------------------------------------------------------------------
 * Require Statements << Keep in alphabetical order >>
 * ---------------------------------------------------------------- */

var Crypto = require('crypto');
var Fs = require('fs');
var ODBC = require('odbc');
var Path = require('path');

/* =============================================================================
 * 
 * Mayflower Class
 * 
 * All of the methods are synchronous for ease of development.
 *  
 * ========================================================================== */

module.exports = Mayflower;

function Mayflower(connectionString, migrateDirectory, migrationsTable) {

  /* -------------------------------------------------------------------
   * Private Members Declaration << no methods >>
   * ---------------------------------------------------------------- */

  var _this = this;

  var _tableExists = false;
  var _splitOnGo = /^\s*GO\s*$/gim;

  if (!migrationsTable)
    migrationsTable = 'Migrations';
  
  var MIGRATIONS_TABLE_SCHEMA =
    "CREATE TABLE [" + migrationsTable + "](\
      [Id] [int] IDENTITY(1,1) NOT NULL,\
      [Filename] [nvarchar](260) NULL,\
      [Hash] [varchar](40) NULL,\
      [ExecutionDate] [datetime] NULL,\
      [Duration] [int] NULL,\
      \
      PRIMARY KEY CLUSTERED \
      (\
        [Id] ASC\
      )WITH (PAD_INDEX = OFF, STATISTICS_NORECOMPUTE = OFF, IGNORE_DUP_KEY = OFF, ALLOW_ROW_LOCKS = ON, ALLOW_PAGE_LOCKS = ON) ON [PRIMARY]\
    ) ON [PRIMARY]\
    ";

  /* -------------------------------------------------------------------
   * Public Methods << Keep in alphabetical order >>
   * ---------------------------------------------------------------- */

  this.getAllScripts = function () {
    var sqlExt = /.+\.sql$/;
    var names = [];
    var files = Fs.readdirSync(migrateDirectory);

    for (var i in files) {
      if (sqlExt.test(files[i]))
        names.push(files[i]);
    }

    names.sort();
    return names.map(_this.getScript);
  };

  this.getDbConnection = function () {
    var db = ODBC();
    db.openSync(connectionString);
    return db;
  };

  this.getScript = function (name) {
    var sql = Fs.readFileSync(Path.join(migrateDirectory, name), { encoding: 'utf8' });

    return {
      name: name,
      hash: getHash(sql),
      commands: sql.split(_splitOnGo)
    };
  };

  this.migrateAll = function (options) {
    try {
      //default options
      if (!options || typeof options !== 'object') {
        options = {};
      }
      
      if (options.output === undefined)
        options.output = true;

      //open db and read sql script files
      var db = _this.getDbConnection();
      var scripts = _this.getAllScripts();

      //migrate each script
      var skipped = 0;
      var results = new Array(scripts.length);
      for (var i in scripts) {
        results[i] = _this.migrate(db, options, scripts[i]);

        if (results[i].skipped)
          skipped++;

        if (results[i].message && options.output) {
          console.log(results[i].message);
        }
      }

      if (options.output && skipped > 0) {
        console.log(skipped + ' previously applied migrations were skipped.');
      }

      db.closeSync();
      return results;

    } catch (ex) {
      if (db && db.connected)
        db.closeSync();
      
      return ex;
    }
  };

  this.migrate = function (db, options, script) {
    var ret = {
      name: script.name,
      skipped: true,
      runtime: 0,
      message: null
    };

    createMigrationsTable(db, options);
    var rows = (!_tableExists && options.preview) ? [] : db.querySync('select top 1 * from [' + migrationsTable + '] where [Hash] = ?', [ script.hash ]);

    if (rows.length > 0) {
      var r = rows[0];
      if (r.Filename !== script.name) {
        ret.message = 'Filename has changed in the database; updating ' + script.name;
        if (!options.preview)
          db.querySync('update [' + migrationsTable + '] set Filename = ? where [Hash] = ?', [ script.name, script.hash ]);
      }
    } else {
      var exists = false;

      rows = (!_tableExists && options.preview) ? [] : db.querySync('select 1 from [' + migrationsTable + '] where [Filename] = ?', [ script.name ]);
      if (rows.length > 0) {
        if (!options.force) {
          throw new Error('Failed to migrate: ' + script.name + ' (Hash: ' + script.hash + ') - the file was already migrated in the past, to force migration use the --force command');
        }
        exists = true;
      }

      try {
        //start timer
        var start = process.hrtime();

        //begin transaction
        db.beginTransactionSync();

        var c;
        //execute each command
        for (var i in script.commands) {
          c = script.commands[i].trim();
          if (!c)
            continue;
          db.querySync(script.commands[i]);
        }

        //convert duration into milliseconds
        var duration = process.hrtime(start);
        ret.runtime = Math.round((duration[0] * 1000) + (duration[1] / 1000000));

        //mark migration as applied in the database
        var params = [ script.hash, new Date().toISOString(), ret.runtime, script.name ];
        if (_tableExists || !options.preview) {
          if (exists) {
            db.querySync('UPDATE [' + migrationsTable + '] SET [Hash] = ?, [ExecutionDate] = ?, [Duration] = ? WHERE [Filename] = ?', params);
          }
          else {
            db.querySync('INSERT [' + migrationsTable + '] ([Hash], [ExecutionDate], [Duration], [Filename]) VALUES(?, ?, ?, ?)', params)
          }
        }

        //commit transaction
        if (options.preview)
          db.rollbackTransactionSync();
        else
          db.commitTransactionSync();
        ret.skipped = false;
        ret.message = 'Successfully migrated ' + script.name;

      } catch (ex) {
        db.rollbackTransactionSync();
        throw new Error('Failed to run migration: ' + script.name + " " + ex.message);
      }
    }

    return ret;
  };

  /* -------------------------------------------------------------------
   * Private Methods << Keep in alphabetical order >>
   * ---------------------------------------------------------------- */

  function createMigrationsTable(db, options) {
    if (_tableExists)
      return;

    var rows = db.querySync("select * from INFORMATION_SCHEMA.TABLES where TABLE_NAME = ?", [ migrationsTable ]);

    if (rows.length > 0) {
      _tableExists = true;
      return;
    }

    if (!options.preview) {
      db.querySync(MIGRATIONS_TABLE_SCHEMA);
      _tableExists = true;
    }
  }
  
  //returns an md5 hash formatted like a GUID (for compatibility with the C# migrator implementation).
  function getHash (sql) {
    var md5 = Crypto.createHash('md5');
    md5.update(sql);
    var parts = /^(.{8})(.{4})(.{4})(.{4})(.{12})$/.exec(md5.digest('hex'));
    return parts[1] + '-' + parts[2] + '-' + parts[3] + '-' + parts[4] + '-' + parts[5];
  }

}
