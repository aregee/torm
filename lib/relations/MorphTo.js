var Promise = require('bluebird');
var _ = require('lodash');

var Scope = require('../Scope');
var Track = require('../Track');

module.exports = MorphTo;

function MorphTo(from, tables, typeField, foreignKey) {

    var relation = function (model) {
        relation.activeModel = model;
        return relation;
    };

    relation.__proto__ = MorphTo.methods;
    relation.__proto__.constructor = MorphTo;

    relation.from = from;
    relation.tables = _.transform(tables, function (result, table, index) {
        result[table.tableName] = table;
    }, {});

    relation.typeField = typeField;
    relation.foreignKey = foreignKey;

    relation.constraints = Track();

    return relation;
}

MorphTo.methods = {
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

        return this.get(models).then(function (result) {
            var dict = {};

            _.forEach(result, function (relatedModels, table) {
                dict[table] = {};

                relatedModels.forEach(function (model) {
                    dict[table][model[relation.tables[table].keyName]] = model;
                });
            });

            models.forEach(function (model) {
                var type = model[relation.typeField];
                var foreign = model[relation.foreignKey];

                if (dict[type] && dict[type][foreign]) {
                    model[relationName] = dict[type][foreign];
                }
            });

            return models;
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

        var relation = this;

        var tables = _.transform(this.tables, function (tables, table, name) {
            var table = relation.constrain(table.fork());

            var keys = models.filter(function (model) {
                return model[relation.typeField] === name;
            }).map(function (model) {
                return model[relation.foreignKey];
            });

            if (takeFirst === true) {
                tables[name] = table.where(table.key(), 'in', keys).first();
            } else {
                tables[name] = table.where(table.key(), 'in', keys).all();
            }

            return tables;
        }, {});

        return Promise.props(tables).then(function (result) {
            if (takeFirst === true) {
                var type = models[0][relation.typeField];
                return result[type];
            } else {
                return result;
            }
        });
    },

    associate: function (fromModel, toModel, tableName) {
        if (arguments.length === 2) {
            return this.associate(this.activeModel, fromModel, toModel);
        }

        var table = this.tables[tableName];

        fromModel[this.typeField] = tableName;
        fromModel[this.foreignKey] = toModel[table.keyName];

        return this.from.save(fromModel);
    },

    dissociate: function (fromModel) {
        if (arguments.length === 0) {
            return this.dissociate(this.activeModel);
        }

        fromModel[this.typeField] = null;
        fromModel[this.foreignKey] = null;

        return this.from.save(fromModel);
    },

    save: function (fromModel, values, tableName) {
        if (arguments.length === 2) {
            return this.save(this.activeModel, fromModel);
        }

        var table = this.tables[tableName];

        return table.save(values).then(function (toModel) {
            return this.associate(fromModel, toModel, tableName);
        }.bind(this));
    },

    update: function (fromModel, values) {
        if (arguments.length === 1) {
            return this.update(this.activeModel, fromModel);
        }

        var table = this.tables[fromModel[this.typeField]];

        return this.constraints(table.fork())
            .where(table.keyName, '=', fromModel[this.foreignKey])
            .update(values);
    },

    del: function (fromModel) {
        if (arguments.length === 0) {
            return this.del(this.activeModel);
        }

        var table = this.tables[fromModel[this.typeField]];

        return this.constraints(table.fork())
            .where(table.keyName, '=', fromModel[this.foreignKey])
            .del();
    }
};