var Promise = require('bluebird');
var _ = require('lodash');

var Scope = require('../Scope');
var Track = require('../Track');

module.exports = HasOne;

function HasOne(from, to, foreignKey, key) {

    var relation = function (model) {
        relation.activeModel = model;
        return relation;
    };

    relation.__proto__ = HasOne.methods;
    relation.__proto__.constructor = HasOne;

    relation.from = from;
    relation.to = to;
    relation.foreignKey = foreignKey;
    relation.key = key;

    relation.constraints = Track();

    return relation;
};

HasOne.methods = {
    eagerLoad: function (args) {
        return this.constrain(function (t) {
            t.eagerLoad(args);
        });

        return this;
    },

    constrain: function (constraint) {
        this.constraints.push(Scope(constraint, 'constraint'));
        return this;
    },

    init: function (models, relationName) {
        if (! _.isArray(models)) {
            return this.init([models], relationName);
        }

        models.forEach(function (model) {
            model[relationName] = undefined;
        });

        return this;
    },

    load: function (models, relationName, takeFirst) {
        if (! _.isArray(models)) {
            return this.load([models], relationName, true);
        }

        this.init(models, relationName);

        var idDict = this.from.idDict(models, this.key);
        var relation = this;

        return this.get(models).then(function (relatedModels) {
            relatedModels.forEach(function (relatedModel) {
                var model = idDict[relatedModel[relation.foreignKey]];
                model[relationName] = relatedModel;
            });

            if (takeFirst === true) {
                return models[0];
            } else {
                return models;
            }
        });
    },

    get: function (models, takeFirst) {
        if (arguments.length === 0) {
            return this.get([this.activeModel], true);
        }

        models = models.filter(function (model) {
            return !!model;
        });

        if (models.length === 0) {
            if (takeFirst === true) {
                return Promise.resolve(undefined);
            } else {
                return Promise.resolve([]);
            }
        }

        var from = this.from;
        var to = this.constraints(this.to.fork());

        var keys = _.pluck(models, this.key);

        if (takeFirst === true) {
            return to.where(this.foreignKey, 'in', keys).first();
        } else {
            return to.where(this.foreignKey, 'in', keys).all();
        }
    },

    save: function (fromModel, values) {
        if (arguments.length === 1) {
            return this.create(this.activeModel, fromModel);
        }

        if (_.isArray(values)) {
            values.forEach(function (value) {
                value[this.foreignKey] = fromModel[this.key];
            }.bind(this));
        } else {
            values[this.foreignKey] = fromModel[this.key];
        }

        return this.to.save(values);
    },

    update: function (fromModel, values) {
        if (arguments.length === 1) {
            return this.update(this.activeModel, fromModel);
        }

        return this.constraints(this.to.fork())
            .where(this.foreignKey, '=', fromModel[this.key])
            .update(values);
    },

    del: function (fromModel) {
        if (arguments.length === 0) {
            return this.del(this.activeModel);
        }

        return this.constraints(this.to.fork())
            .where(this.foreignKey, '=', fromModel[this.key])
            .del();
    }
};