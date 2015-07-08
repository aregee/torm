module.exports = Hash;

function Hash(name, client) {
    var hash = function (key, val, lifetime) {
        if (arguments.length === 1) {
            return hash.get(key);
        } else if (arguments.length > 1) {
            return hash.set(key, val, lifetime);
        }
    };

    hash.__proto__ = Hash.methods;
    hash.__proto__.constructor = Hash;

    hash._name = name;
    hash._client = client;
}

Hash.methods = {
    fullKey: function (key) {
        return [this._name, key].join('.');
    },

    get: function (key) {
        return this._client.get(this.fullKey(key));
    },

    set: function (key, val, lifetime) {
        return this._client.set(this.fullKey(key), val, lifetime);
    },

    del: function (key) {
        return this._client.del(this.fullKey(key));
    },

    clear: function () {
        return this._client.cleanup(this._name);
    }
}