# Mayflower

A simple database migration utility for making schema changes, or other one-time modifications, to a SQL Server database. It is a node.js port of the C# SQL Server migrator which Stack Overflow uses.

It's the _Mayflower_ because... you use it to migrate, obviously.

## Requirements

Mayflower uses [node-odbc](https://github.com/wankdanker/node-odbc) to talk to SQL server. This, in turn, requires an ODBC driver such as FreeTDS. On CentOS, this can be setup as follows:

Create a file in your home directory ~/ called tds.driver.template with the following contents:

```
[FreeTDS]
Description = Free TDS ODBC Driver
Driver = /usr/lib64/libtdsodbc.so
```

Then install and configure FreeTDS with the following commands:

```
mkdir -p /opt/epel
cd /opt/epel

EPELRPM=epel-release-6-8.noarch.rpm

wget -q -N "http://dl.fedoraproject.org/pub/epel/6/i386/$EPELRPM"
rpm -ivh "$EPELRPM"

yum install -y unixODBC unixODBC-devel freetds

odbcinst -i -d -f ~/tds.driver.template
```

## Install

Mayflower is not currently in npm, simply because there hasn't been a discussion about open-sourcing it yet.

To add it to your package.json file, use this format:

```javascript
{
  "dependencies": {
    "mayflower": "git+ssh://git@github.com:StackExchange/mayflower.git"
  }
}
```

And then run `npm install`. NPM is ignorant of any changes made to a git repository, so you would need to upgrade the Mayflower package at any point, run `npm update mayflower`.

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
    -j, --json [filename]    Name of a json file where the connection string.
    -k, --key [key]          The key inside the json file for the connection string (dot notation).
```

A directory, plus either 1. a connection string, or 2. a json file and key, must be provided. All other parameters are optional.

__Example__

/etc/project/config.json

```javascript
{
  "sqlServer": {
    "myDb": "DRIVER={FreeTDS};SERVER=localhost;PORT=1433;DATABASE=MyDb;UID=me;PWD=mypassword;TDS_VERSION=7.2"
  }
}
```

migrate.sh

    ./node_modules/.bin/mayflower -d ./migrations -j /etc/project/config.json -k "sqlServer.myDb"

### Programmatic

#### Constructor

    Mayflower(connectionString, migrateDirectory, migrationsTable)

* `connectionString` The string used to create a connection to the database.
* `migrateDirectory` The directory where to look for `*.sql` scripts.
* `migrationsTable` The name of the table where migration history will be stored (defaults to "Migrations"). This table will be created if it does not already exist.

#### Migrating

The only method you will likely care about is `migrateAll( options )`

* `options` An optional object parameter with the following defaults: `{ output: true, force: false }`
    * `output` determines whether `migrateAll()` will execute `console.log` statements.
    * `force` If true, previously applied migration scripts will be run again.

___Returns___ an array of result objects, each with the following format:

```javascript
{
  name: String,        // filename of the .sql script
  skipped: Boolean,    // true indicates the script has been previously applied and was skipped
  runtime: Number,     // number of milliseconds the script required to run
  message: String|null // human readable message
}
```

If an error occured, the return value will be a single Error object instead of an array.

__Example__

```javascript
var Mayflower = require('mayflower');
var connString = 'DRIVER={FreeTDS};SERVER=localhost;PORT=1433;DATABASE=MyDb;UID=me;PWD=mypassword;TDS_VERSION=7.2';
var m = new Mayflower(connString, 'path/to/migrations');

var results = m.migrateAll();

if (results instanceof Error) {
  console.error(results.stack);
  process.exit(1);
}

process.exit(0);
```

#### Additional Methods

There are a few additional public methods which are used internally, but may have limited external usefulness. Review the implementation in [lib/mayflower.js](https://github.com/StackExchange/mayflower/blob/master/lib/mayflower.js) for details.

* `migrate ( db, options, script )` Migrates only a single script.
* `getDbConnection ( )` Opens a database connection.
* `getAllScripts ( )` Returns an array of script objects.
* `getScript ( name )` Returns a single script object.
