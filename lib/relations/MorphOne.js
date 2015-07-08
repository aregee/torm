var Promise = require('bluebird');
var _ = require('lodash');

var Scope = require('../Scope');
var Track = require('../Track');

module.exports = MorphOne;

function MorphOne(from, to, inverse) {

    var relation = function (model) {
        relation.activeModel = model;
        return relation;
    };

    relation.__proto__ = MorphOne.methods;
    relation.__proto__.constructor = MorphOne;

    relation.from = from;
    relation.to = to;
    relation.inverse = inverse;

    relation.constraints = Track();

    return relation;
}

MorphOne.methods = {
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

        var idDict = this.from.idDict(models, this.from.keyName);
        var relation = this;

        return this.get(models).then(function (relatedModels) {
            relatedModels.forEach(function (relatedModel) {
                var model = idDict[relatedModel[relation.inverse.foreignKey]];
                model[relationName] = relatedModel;
            });

            if (takeFirst === true) {
                return models[0];
            } else {
                return models;
            }
        });
    },

    get: function(models, takeFirst) {
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

        var typeField = relation.inverse.typeField;
        var typeValue = this.from.tableName;
        var foreignKey = relation.inverse.foreignKey;

        var keys = _.pluck(models, this.from.keyName);

        var to = this.constraints(this.to.fork());

        if (takeFirst === true) {
            return to.where(typeField, typeValue).whereIn(foreignKey, keys).first();
        } else {
            return to.where(typeField, typeValue).whereIn(foreignKey, keys).all();
        }
    },

    save: function (fromModel, values) {
        if (arguments.length === 1) {
            return this.create(this.activeModel, fromModel);
        }

        var typeField = this.inverse.typeField;
        var typeValue = this.from.tableName;
        var foreignKey = relation.inverse.foreignKey;

        if (_.isArray(values)) {
            values.forEach(function (value) {
                value[foreignKey] = fromModel[this.from.keyName];
                value[typeField] = typeValue;
            }.bind(this));
        } else {
            values[foreignKey] = fromModel[this.from.keyName];
            values[typeField] = typeValue;
        }

        return this.to.save(values);
    },

    update: function (fromModel, values) {
        if (arguments.length === 1) {
            return this.update(this.activeModel, fromModel);
        }

        var typeField = this.inverse.typeField;
        var typeValue = this.from.tableName;
        var foreignKey = relation.inverse.foreignKey;

        return this.constraints(this.to.fork())
            .where(typeField, '=', typeValue)
            .where(foreignKey, '=', fromModel[this.from.keyName])
            .update(values);
    },

    del: function (fromModel) {
        if (arguments.length === 0) {
            return this.del(this.activeModel);
        }

        var typeField = this.inverse.typeField;
        var typeValue = this.from.tableName;
        var foreignKey = relation.inverse.foreignKey;

        return this.constraints(this.to.fork())
            .where(typeField, '=', typeValue)
            .where(foreignKey, '=', fromModel[this.from.keyName])
            .del();
    }
}