var Promise = require('bluebird');
var _ = require('lodash');

var Scope = require('../Scope');
var Track = require('../Track');

module.exports = HasManyThrough;

function HasManyThrough(from, to, through, foreignKey, secondKey) {

    var relation = function (model) {
        relation.activeModel = model;
        return relation;
    };

    relation.__proto__ = HasManyThrough.methods;
    relation.__proto__.constructor = HasManyThrough;

    relation.from = from;
    relation.to = to;
    relation.through = through;
    relation.foreignKey = foreignKey;
    relation.secondKey = secondKey;

    relation.throughFields = [foreignKey, secondKey];

    relation.constraints = Track();

    relation.constrain(function (t) {
        t.scope(function (q) {
            q.join(through.tableName, through.key(), '=', to.c(secondKey));
        });
    });

    return relation;
};

HasManyThrough.methods = {
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
            model[relationName] = [];
        });

        return this;
    },

    load: function (models, relationName, takeFirst) {
        if (! _.isArray(models)) {
            return this.load([models], true);
        }

        this.init(models, relationName);

        var idDict = this.from.idDict(models, this.key);
        var relation = this;

        return this.get(models).then(function (relatedModels) {
            relatedModels.forEach(function (relatedModel) {
                var model = idDict[relatedModel.through[relation.foreignKey]];
                model[relationName].push(relatedModel);
            });

            if (takeFirst === true) {
                return models[0];
            } else {
                return models;
            }
        });
    },

    _isThroughAlias: function (field) {
        return field.indexOf(this._throughAlias()) > -1;
    },

    _throughAlias: function (field) {
        field = field || '';
        return this.through.tableName + '__' + field;
    },

    _throughAliasToField: function (alias) {
        return alias.slice(this._throughAlias().length);
    },

    get: function (models) {
        if (arguments.length === 0) {
            return this.get([this.activeModel]);
        }

        models = models.filter(function (model) {
            return !!model;
        });

        if (models.length === 0) {
            return Promise.resolve([]);
        }

        var relation = this;
        var from = this.from;
        var to = this.constraints(this.to.fork());

        var keys = _.pluck(models, from.keyName);

        var cols = ['*'].concat(this.throughFields.map(function (field) {
            return this.through.c(field)+' as '+this._throughAlias(field);
        }.bind(this)));

        return to.where(this.through.c(this.foreignKey), 'in', keys)
                 .select(cols).all().then(function (models) {
                    return models.map(function (model) {
                        var through = _.transform(model, function (through, val, field) {
                            if (relation._isThroughAlias(field)) {
                                through[relation._throughAliasToField(field)] = val;
                            }

                            return through;
                        }, {});

                        model = _.transform(model, function (model, val, field) {
                            if (! relation._isThroughAlias(field)) {
                                model[field] = val;
                            }

                            return model;
                        }, {});

                        model.through = through;

                        return model;
                    });
                 });
    }
};