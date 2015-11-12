var Promise = require('bluebird');
var _ = require('lodash');

var Redis = require('./redis/Client');
var Table = require('./Table');

module.exports = Orm;

function Orm(config) {
  function orm(table, transaction) {
    var table = orm.tables[table].fork();

    if (arguments.length === 2) {
      table.transacting(transaction);
    }

    return table;
  }

  orm.__proto__ = Orm.methods;
  orm.__proto__.constructor = Orm;

  // tables cache
  orm.tables = {};

  // columns cache
  orm.columns = {};

  // parse config
  var dbConf, redisConf;

  if (config.hasOwnProperty('db')) {
    dbConf = config.db;

    if (orm.hasOwnProperty('redis')) {
      redisConf = config.redis;
    }
  } else {
    dbConf = config;
  }

  // setup knex
  orm.knex = require('knex')(dbConf);

  // raw helper
  orm.raw = orm.knex.raw;

  // transaction helper
  orm.transaction = orm.knex.transaction;

  // redis settings
  if (redisConf) {
    orm.redis = new Redis(redisConf);
  }

  return orm;
}

Orm.methods = {
  Table: function (one, two) {
    // if (one) is an object, that means
    // a table is being declared
    if (_.isObject(one)) {
      this.tables[one.tableName] = Table(this, one);
      return this;
    } else if (_.isString(one) && _.isFunction(two)) {
      // if (one) is a string and (two) is a function
      // that means a table is being mutated
      two(this.tables[one]);
      return this;
    }
  },

  // a transaction wrapper
  // usage:
  // return orm.trx(function (t) {
  //   return orm('users', t).save([{}, {}, {}]);
  // }).then(function (users) {
  //        
  // });
  trx: function (promiseFn) {
    var outerResult;
    
    return this.transaction(function (t) {
      return promiseFn(t).then(function (result) {
        return t.commit().then(function () {
          outerResult = result;
          return result;
        });
      }).catch(function (e) {
        t.rollback();
        throw e;
      });
    }).then(function () {
      return outerResult;
    });
  },

  // method to close the database
  close: function () {
    var promises = this.knex.destroy();

    if (this.redis) {
      promises.push(this.redis.quit());
    }

    return Promise.all(promises);
  },

  // here, we load the columns of all the tables that have been
  // defined via the orm, and return a promise on completion
  // cos, if people wanna do that before starting the server
  // let em do that
  load: function () {
    return Promise.all(_.map(this.tables, function (table) {
      return table.loadColumns();
    }));
  }
};