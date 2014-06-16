# Mayflower

[![Dependency Status](https://gemnasium.com/StackExchange/mayflower.svg)](https://gemnasium.com/StackExchange/mayflower)

A simple database migration utility for making schema changes, or other one-time modifications, to a SQL Server database. It is a node.js port of the C# SQL Server migrator which Stack Overflow uses.

It's the _Mayflower_ because... you use it to migrate, obviously.

## Install

    npm install mayflower

Mayflower uses [mssql](https://github.com/patriksimek/node-mssql) and [tedious](https://github.com/pekim/tedious) libraries for SQL Server communication, and supports all operating systems.

## Usage

There are both programmatic and commandline interfaces to Mayflower.

### Commandline

The commandline interface is relatively self-explanatory. After installing the package in your project, npm places an executable at `/project_root/node_modules/.bin/mayflower`.

```
$ ./node_modules/.bin/mayflower --help

  Usage: mayflower [options]

  Options:

    -h, --help               output usage information
    -c, --connection [str]   Connection string to SQL Server Database.
    -d, --directory <dir>    Directory containing migration scripts.
    -f, --force              Forces scripts which have already been applied to be applied again.
    -s, --script [filename]  Specifies only a single script to be run.
    -t, --table [name]       Name of the Migrations history table (default: Migrations).
    -j, --json [filename]    Name of a json file where the connection object.
    -k, --key [key]          The key inside the json file for the connection object (dot notation).
    -p, --preview            Outputs results for migration scripts, but rolls back every transaction.
```

A directory, plus either 1. a connection string, or 2. a json file and key, must be provided. All other parameters are optional.

__Example__

/etc/project/config.json

```javascript
{
  "sqlServer": {
    "myDb": {
      "server": "localhost",
      "database": "database_name",
      "port": 1433,
      "user": "user",
      "password": "password",
      "options": {
        "tdsVersion": "7_4"
      }
    }
  }
}
```

For legacy purposes, using a connection string instead of an object is also supported:

```javascript
{
  "sqlServer": {
    "myDb": "SERVER=localhost;PORT=1433;DATABASE=MyDb;UID=me;PWD=mypassword;TDS_VERSION=7.4"
  }
}
```

migrate.sh

    ./node_modules/.bin/mayflower -d ./migrations -j /etc/project/config.json -k "sqlServer.myDb"

### Programmatic

#### Constructor

    Mayflower(connectionString, migrateDirectory, migrationsTable)

* `connectionObject` The object or string used to create a connection to the database.
* `migrateDirectory` The directory where to look for `*.sql` scripts.
* `migrationsTable` The name of the table where migration history will be stored (defaults to "Migrations"). This table will be created if it does not already exist.

#### Migrating

The only method you will likely care about is `migrateAll( options, callback )`

* `options` An optional object parameter with the following defaults: `{ output: true, force: false }`
    * `output` determines whether `migrateAll()` will execute `console.log` statements.
    * `force` If true, previously applied migration scripts will be run again.
    * `preview` If true, all of the migration scripts run as expected, but the SQL transactions are rolled back, so the changes do not take affect.
* `callback` A function which accepts two arguments: an Error, and an array of MigrationResults.

Each `MigrationResult` has the following format:

```javascript
{
  name: String,        // filename of the .sql script
  skipped: Boolean,    // true indicates the script has been previously applied and was skipped
  runtime: Number,     // number of milliseconds the script required to run
  message: String|null // human readable message
}
```

For an example, see [cli.js](https://github.com/StackExchange/mayflower/blob/master/lib/cli.js).

#### Additional Methods

There are a few additional public methods which are used internally, but may have limited external usefulness. Review the implementation in [lib/mayflower.js](https://github.com/StackExchange/mayflower/blob/master/lib/mayflower.js) for details.

* `migrate ( db, options, script, callback )` Migrates only a single script.
    * `db` A dbConnection obtained from `getDbConnection()`.
    * `options` Same as the options accepted by `migrateAll()`.
    * `script` must be a Script object returned from `getScript()` or `getAllScripts()`.
    * `callback` signature: `(error, MigrationResult)`
* `getDbConnection ( callback )` Opens a database connection. Callback signature `(error, dbConnection)`
* `getAllScripts ( )` Returns an array of script objects.
* `getScript ( name )` Returns a single script object. Name is relative to the `migrationDirectory` which the Mayflower object was constructed with.
