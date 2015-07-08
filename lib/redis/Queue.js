module.exports = Queue;

function Queue(name, client) {
    var q = function (args) {
        args = Array.prototype.slice.call(arguments, 0);
        if (args.length === 0) {
            return q.dq();
        } else {
            return q.nq(args);
        }
    };

    q.__proto__ = Queue.methods;
    q.__proto__.constructor = Queue;

    q._name = name;
    q._client = client;

    return q;
};

Queue.methods = {
    dq: function () {
        return this._client.dq(this._name);
    },

    nq: function (args) {
        if (! args instanceof Array) {
            args = Array.prototype.slice.call(arguments, 0);
        }

        return this._client.nq(this._name, args);
    },

    clear: function () {
        return this._client.cleanup(this._name);
    }
};