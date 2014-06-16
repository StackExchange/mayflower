"use strict";
/* -------------------------------------------------------------------
 * Require Statements << Keep in alphabetical order >>
 * ---------------------------------------------------------------- */

var Athena = require('odyssey').athena;
var Crypto = require('crypto');
var Fs = require('fs');
var httpLog = require('odyssey').httpLog;
var MsSql = require('mssql');
var Path = require('path');

var Connection = MsSql.Connection;

/* =============================================================================
 * 
 * Mayflower Class
 * 
 * All of the methods are synchronous for ease of development.
 *  
 * ========================================================================== */

module.exports = Mayflower;

function Mayflower (connectionObject, migrateDirectory, migrationsTable)
{
	/* -------------------------------------------------------------------
	   * Private Members Declaration << no methods >>
	   * ---------------------------------------------------------------- */

	var _this = this;

	var _tableExists = false;
	var _config = typeof connectionObject === 'string' ? parseConnectionString(connectionObject) : connectionObject;

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

	/**
	 * @returns {Script[]}
	 */
	this.getAllScripts = function ()
	{
		var sqlExt = /.+\.sql$/;
		var names = [];
		var files = Fs.readdirSync(migrateDirectory);

		var i;
		for (i in files)
		{
			if (sqlExt.test(files[i]))
				names.push(files[i]);
		}

		names.sort();
		var scripts = [];
		/** @type {Script} */
		var s;
		for (i = 0; i < names.length; i++)
		{
			s = _this.getScript(names[i]);
			if (s.commands.length > 0) // filter out scripts without any commands
				scripts.push(s);
		}
		
		return scripts;
	};

	/**
	 * @param callback {function(?Error, Connection)}
	 */
	this.getDbConnection = function (callback)
	{
		var db = new Connection(_config);
		db.connect(function (error)
		{
			callback(error, db);
		});
	};

	/**
	 * @param name {string}
	 * @returns {Script}
	 */
	this.getScript = function (name)
	{
		var sql = Fs.readFileSync(Path.join(migrateDirectory, name), { encoding: 'utf8' });
		return new Script(name, sql);
	};

	/**
	 * @param options {object}
	 * @param callback {function(?Error, MigrationResult[]=)}
	 */
	this.migrateAll = function (options, callback)
	{
		//default options
		if (!options || typeof options !== 'object')
		{
			options = {};
		}

		if (options.output === undefined)
			options.output = true;
		
		/** @type {Connection} */
		var db;
		/** @type {Script[]} */
		var scripts;
		
		Athena.waterfall(
			[
				_this.getDbConnection,
				function (cb, d)
				{
					db = d;
					scripts = _this.getAllScripts();
					Athena.mapSeries(
						scripts,
						function (cb, script)
						{
							_this.migrate(db, options, script, cb);
						},
						cb
					);
				}
			],
			function (hlog, results)
			{
				if (db)
					db.close();
				
				if (results instanceof Array)
				{
					var skipped = 0;
					for (var i = 0; i < results.length; i++)
					{
						if (!results[i])
							continue;
						
						if (results[i].skipped)
							skipped++;

						if (results[i].message && options.output)
						{
							console.log(results[i].message);
						}
					}

					if (options.output && skipped > 0)
					{
						console.log(skipped + ' previously applied migrations were skipped.');
					}
				}
				
				callback(hlog.failed ? hlog : null, results);
			}
		);
	};

	/**
	 * @param db {Connection}
	 * @param options {*}
	 * @param script {Script}
	 * @param callback {function(?Error, MigrationResult=)}
	 */
	this.migrate = function (db, options, script, callback)
	{
		var result = new MigrationResult(script.name);
		var exists = false;
		var tran, start;
		
		Athena.waterfall(
			[
				function (cb)
				{
					createMigrationsTable(db, options, cb);
				},
				function (cb)
				{
					if (!_tableExists && options.preview)
					{
						// pretend like the table exists but is empty in preview mode
						cb(null, []);
					}
					else
					{
						// check for previous migration by hash
						var request = db.request();
						request.input('hash', MsSql.NVarChar('max'), script.hash);
						request.query('select top 1 * from [' + migrationsTable + '] where [Hash] = @hash', cb);
					}
				},
				function (cb, rows)
				{
					var request;
					if (rows.length > 0)
					{
						// migration has already been applied
						var r = rows[0];
						if (r.Filename !== script.name)
						{
							result.message = 'Filename has changed in the database; updating ' + script.name;
							if (!options.preview)
							{
								request = db.request();
								request.input('script', MsSql.NVarChar('max'), script.name);
								request.input('hash', MsSql.NVarChar('max'), script.hash);
								request.query('update [' + migrationsTable + '] set Filename = @script where [Hash] = @hash', cb.break);

								return;
							}
						}

						cb.break();
						return;
					}

					// check for previous migration by filename
					if (!_tableExists && options.preview)
					{
						cb(null, []);
					}
					else
					{
						request = db.request();
						request.input('script', MsSql.NVarChar('max'), script.name);
						request.query('select 1 from [' + migrationsTable + '] where [Filename] = @script', cb);
					}
				},
				function (cb, rows)
				{
					if (rows.length > 0)
					{
						if (!options.force)
						{
							cb(new Error('Failed to migrate: ' + script.name + ' (Hash: ' + script.hash + ') - the file was already migrated in the past, to force migration use the --force command'));
							return;
						}
						exists = true;
					}

					// begin migration transaction
					tran = db.transaction();
					tran.begin(function (error)
					{
						if (error)
							tran = null; // so we don't try to rollback a transaction which didn't actually begin
						
						cb(error);
					});
				},
				function (cb)
				{
					// start timer
					start = process.hrtime();
					
					// run migration commands
					Athena.mapSeries(
						script.commands,
						function (cb, command)
						{
							var request = tran.request();
							request.query(command.trim(), cb);
						},
						cb
					);
				},
				function (cb)
				{
					// stop timer
					var duration = process.hrtime(start);
					result.runtime = Math.round((duration[0] * 1000) + (duration[1] / 1000000));

					// mark migration as applied in the database
					if (_tableExists || !options.preview)
					{
						var request = tran.request();
						var sql;
						if (exists)
						{
							sql = 'UPDATE [' + migrationsTable + '] SET [Hash] = @hash, [ExecutionDate] = @execDate, [Duration] = @duration WHERE [Filename] = @script';
						}
						else
						{
							sql = 'INSERT [' + migrationsTable + '] ([Hash], [ExecutionDate], [Duration], [Filename]) VALUES(@hash, @execDate, @duration, @script)';
						}

						request.input('hash', MsSql.NVarChar('max'), script.hash);
						request.input('execDate', MsSql.DateTime, new Date());
						request.input('duration', MsSql.Int, result.runtime);
						request.input('script', MsSql.NVarChar('max'), script.name);
						request.query(sql, cb);
					}
					else
					{
						cb();
					}
				},
				function (cb)
				{
					if (options.preview)
						tran.rollback(cb);
					else
						tran.commit(cb);
				},
				function (cb)
				{
					tran = null;
					result.skipped = false;
					result.message = 'Successfully migrated ' + script.name;
					cb();
				}
			],
			function (hlog)
			{
				if (hlog.failed)
				{
					if (tran)
					{
						tran.rollback(function (error)
						{
							if (error)
								hlog = httpLog.chain(hlog, error);
							
							callback(hlog);
						});
					}
					else
					{
						callback(hlog);
					}
				}
				else
				{
					callback(null, result);
				}
			}
		);
	};

	/* -------------------------------------------------------------------
	   * Private Methods << Keep in alphabetical order >>
	   * ---------------------------------------------------------------- */

	/**
	 * @param db {Connection}
	 * @param options {*}
	 * @param callback {function(Error=)}
	 */
	function createMigrationsTable (db, options, callback)
	{
		if (_tableExists)
			setImmediate(callback);

		// check if migrations table already exists
		var request = db.request();
		request.input('tableName', MsSql.NVarChar('max'), migrationsTable);
		request.query("select * from INFORMATION_SCHEMA.TABLES where TABLE_NAME = @tableName", function (error, rows)
		{
			if (rows.length > 0)
			{
				_tableExists = true;
				callback();
				return;
			}
			
			if (options.preview)
			{
				callback();
				return;
			}

			// create the migrations table
			request = db.request();
			request.query(MIGRATIONS_TABLE_SCHEMA, function (error)
			{
				if (!error)
					_tableExists = true;
				
				callback(error);
			});
		});
	}

	function parseConnectionString (connString)
	{
		var pairs = connString.split(/;/g),
			pair, i, parts, result = { options: {} };

		for (i in pairs)
		{
			pair = pairs[i];
			parts = pair.split(/=/);

			switch (parts[0])
			{
				case 'SERVER':
					result.server = parts[1];
					break;
				case 'PORT':
					result.port = parts[1];
					break;
				case 'DATABASE':
					result.database = parts[1];
					break;
				case 'UID':
					result.user = parts[1];
					break;
				case 'PWD':
					result.password = parts[1];
					break;
				case 'TDS_VERSION':
					result.options.tdsVersion = parts[1].replace(/\./, '_');
					break;
			}
		}

		return result;
	}
	
}

/* =============================================================================
 * 
 * MigrationResult Class
 *  
 * ========================================================================== */

/**
 * @param name {string}
 * @constructor
 */
function MigrationResult (name)
{
	this.name = name;
	this.skipped = true;
	this.runtime = 0;
	this.message = '';
}

/* =============================================================================
 * 
 * Script Class
 *  
 * ========================================================================== */

/**
 * 
 * @param name {string}
 * @param sql {string}
 * @constructor
 */
function Script (name, sql)
{
	var _splitOnGo = /^\s*GO\s*$/gim;
	
	this.name = name;
	this.hash = getHash(sql);
	this.commands = sql.split(_splitOnGo).filter(function (sql) { return !!sql.trim(); });
}

/* -------------------------------------------------------------------
 * Private Helper Methods << Keep in alphabetical order >>
 * ---------------------------------------------------------------- */

/**
 * Returns an md5 hash formatted like a GUID (for compatibility with the C# migrator implementation).
 * @param sql {string}
 * @returns {string}
 */
function getHash (sql)
{
	var md5 = Crypto.createHash('md5');
	md5.update(sql);
	var parts = /^(.{8})(.{4})(.{4})(.{4})(.{12})$/.exec(md5.digest('hex'));
	return parts[1] + '-' + parts[2] + '-' + parts[3] + '-' + parts[4] + '-' + parts[5];
}
