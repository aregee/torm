var Promise = require('bluebird');
var _ = require('lodash');

var Scope = require('../Scope');
var Track = require('../Track');

module.exports = BelongsTo;

function BelongsTo(from, to, foreignKey, otherKey) {

    var relation = function (model) {
        relation.activeModel = model;
        return relation;
    };

    relation.__proto__ = BelongsTo.methods;
    relation.__proto__.constructor = BelongsTo;

    relation.from = from;
    relation.to = to;
    relation.foreignKey = foreignKey;
    relation.otherKey = otherKey;

    relation.constraints = Track();

    return relation;
};

BelongsTo.methods = {
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
    
        var relation = this;

        return this.get(models).then(function (relatedModels) {
            var idDict = relation.to.idDict(relatedModels, relation.otherKey);

            models.forEach(function (model) {
                var relatedModel = idDict[model[relation.foreignKey]];
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

        var foreignKeys = _.pluck(models, this.foreignKey);

        if (takeFirst === true) {
            return to.where(this.otherKey, 'in', foreignKeys).first();
        } else {
            return to.where(this.otherKey, 'in', foreignKeys).all();
        }
    },

    associate: function (fromModel, toModel) {
        if (arguments.length === 1) {
            return this.associate(this.activeModel, fromModel);
        }

        fromModel[this.foreignKey] = toModel[this.otherKey];

        return this.from.save(fromModel);
    },

    dissociate: function (fromModel) {
        if (arguments.length === 0) {
            return this.dissociate(this.activeModel);
        }

        fromModel[this.foreignKey] = null;

        return this.from.save(fromModel);
    },

    save: function (fromModel, values) {
        if (arguments.length === 1) {
            return this.save(this.activeModel, fromModel);
        }

        return this.to.save(values).then(function (toModel) {
            return this.associate(fromModel, toModel);
        }.bind(this));
    },

    update: function (fromModel, values) {
        if (arguments.length === 1) {
            return this.update(this.activeModel, fromModel);
        }

        return this.constraints(this.to.fork())
            .where(this.otherKey, '=', fromModel[this.foreignKey])
            .update(values);
    },

    del: function (fromModel) {
        if (arguments.length === 0) {
            return this.del(this.activeModel);
        }

        return this.constraints(this.to.fork())
            .where(this.otherKey, '=', fromModel[this.foreignKey])
            .del();
    }
};