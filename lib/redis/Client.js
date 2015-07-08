var _ = require('lodash');

var Queue = require('./Queue');
var Hash = require('./Hash');

module.exports = Client;

function Client(config) {
    function redis(args) {
        args = Array.prototype.slice.call(arguments, 0);

        if (args.length === 0) {
            return redis.ioredis;
        }

        if (args.length === 1) {
            return redis.get(args[0]);
        }

        if (args.length === 2) {
            return redis.set(args[0], args[1]);
        }

        if (args.length === 3) {
            return redis.set(args[0], args[1], args[2]);
        }
    }

    redis.__proto__ = Client.methods;
    redis.__proto__.constructor = Client;

    redis.ioredis = new require('ioredis')(config);

    redis.prefix = _.isString(config.prefix) ? config.prefix : '';

    redis.loadDefaultCommands();

    return redis;
}

Client.methods = {
    loadDefaultCommands: function () {
        require('./commands')(this.ioredis);
        return this;
    },

    connect: function () {
        console.log(this.ioredis);
        return this.ioredis.connect();
    },

    set: function (key, val, lifetime) {

        if (isNaN(lifetime)) {
            return this.ioredis.set(key, JSON.stringify(val));
        } else {
            return this.ioredis.psetex(key, lifetime, JSON.stringify(val));
        }
    },

    get: function (key) {
        return this.ioredis.get(key).then(function (val) { return JSON.parse(val); });
    },

    del: function (key) {
        return this.ioredis.del(key);
    },

    nq: function (queue, vals) {
        queue = [this.prefix, queue].join('.');

        if (_.isArray(vals)) {
            vals = vals.map(function (v) { return JSON.stringify(v); });
        } else {
            vals = JSON.stringify(vals);
        }

        return this.ioredis.rpush(queue, vals);
    },

    dq: function (queue) {
        queue = [this.prefix, queue].join('.');

        return this.ioredis.lpop(queue).then(function (val) {
            return JSON.parse(val);
        });
    },

    cleanup: function (prefix) {
        prefix = [this.prefix, (_.isString(prefix) ? prefix : '')].join('.');

        return this.ioredis.cleanup(prefix+'*');
    },

    quit: function () {
        return this.ioredis.quit();
    },

    Queue: function (name) {
        return Queue(name);
    },

    Hash: function (name) {
        return Hash(name);
    }
};