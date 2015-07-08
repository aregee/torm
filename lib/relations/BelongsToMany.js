var Promise = require('bluebird');
var _ = require('lodash');

var Scope = require('../Scope');
var Track = require('../Track');

module.exports = BelongsToMany;

function BelongsToMany(from, to, pivot, foreignKey, otherKey) {

    var relation = function (model) {
        relation.activeModel = model;
        return relation;
    };

    relation.__proto__ = BelongsToMany.methods;
    relation.__proto__.constructor = BelongsToMany;

    relation.from = from;
    relation.to = to;
    relation.pivot = pivot;
    relation.foreignKey = foreignKey;
    relation.otherKey = otherKey;

    relation.pivotFields = [foreignKey, otherKey];

    relation.constraints = Track();

    relation.constrain(function (t) {
        t.scope(function (q) {
            q.join(pivot.tableName, pivot.c(relation.otherKey), '=', to.key());
        });
    });

    return relation;
};

BelongsToMany.methods = {
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

    withPivot: function (pivotFields) {
        if (_.isArray(pivotFields)) {
            this.pivotFields = this.pivotFields.concat(pivotFields);
        }

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
            return this.load([models], relationName, true);
        }

        this.init(models, relationName);

        var idDict = this.from.idDict(models, this.key);
        var relation = this;

        return this.get(models).then(function (relatedModels) {
            relatedModels.forEach(function (relatedModel) {
                var model = idDict[relatedModel.pivot[relation.foreignKey]];
                model[relationName].push(relatedModel);
            });

            if (takeFirst === true) {
                return models[0];
            } else {
                return models;
            }
        });
    },

    _isPivotAlias: function (field) {
        return field.indexOf(this._pivotAlias()) > -1;
    },

    _pivotAlias: function (field) {
        field = field || '';
        return this.pivot.tableName + '__' + field;
    },

    _pivotAliasToField: function (alias) {
        return alias.slice(this._pivotAlias().length);
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

        var cols = ['*'].concat(this.pivotFields.map(function (field) {
            return this.pivot.c(field)+' as '+this._pivotAlias(field);
        }.bind(this)));

        return to.where(this.pivot.c(this.foreignKey), 'in', keys)
                 .select(cols).all().then(function (models) {
                    return models.map(function (model) {
                        var pivot = _.transform(model, function (pivot, val, field) {
                            if (relation._isPivotAlias(field)) {
                                pivot[relation._pivotAliasToField(field)] = val;
                            }

                            return pivot;
                        }, {});

                        model = _.transform(model, function (model, val, field) {
                            if (! relation._isPivotAlias(field)) {
                                model[field] = val;
                            }

                            return model;
                        }, {});

                        model.pivot = pivot;

                        return model;
                    });
                 });
    },

    sync: function (fromModel, values, data) {
        // we are gonna play a game
        // if arguments length is 1 that means we have only values
        // if arguments length is 2 and fromModel is an
        // array, that means fromModel has not been provided.
        // if arguments length is 3 that means we have all 3 args
        if (arguments.length === 1) {
            return this.sync(this.activeModel, fromModel, data);
        }

        if (arguments.length === 2 && _.isArray(fromModel)) {
            return this.sync(this.activeModel, fromModel, values);
        }

        data = data ? data : {};

        var relation = this;

        return relation.pivot.fork()
            .where(relation.foreignKey, '=', fromModel[relation.from.keyName])
            .del().then(function () {
                if (values.length === 0) {
                    return fromModel;
                }

                if (_.isObject(values[0])) {
                    values = _.pluck(values, relation.to.keyName);
                }

                var pivots = values.map(function (v) {
                    var keys = {};
                    keys[relation.foreignKey] = fromModel[relation.from.keyName];
                    keys[relation.otherKey] = v;

                    return _.extend({}, data, keys);
                });

                return relation.pivot.save(pivots);
            });
    },

    attach: function (fromModel, toModel, data) {
        // we are gonna play a game
        // if arguments length is 1 that means we have only values
        // if arguments length is 2 and fromModel is an
        // array, that means fromModel has not been provided.
        // if arguments length is 3 that means we have all 3 args
        
        if (arguments.length === 1) {
            return this.attach(this.activeModel, fromModel, data);
        }

        if (arguments.length === 2 && _.isArray(fromModel)) {
            return this.attach(this.activeModel, fromModel, values);
        }

        data = data ? data : {};

        var keys = {};
        keys[this.foreignKey] = fromModel[this.from.keyName];
        keys[this.otherKey] = toModel[this.to.keyName];

        var pivot = _.extend(data, keys);

        return this.pivot.save(pivot);
    },

    detach: function (fromModel, toModel) {
        // we are gonna play a game
        // if arguments length is 1 that means we have only values
        // if arguments length is 2 and fromModel is an
        // array, that means fromModel has not been provided.
        // if arguments length is 3 that means we have all 3 args
        
        if (arguments.length === 1) {
            return this.detach(this.activeModel, fromModel);
        }

        var keys = {};
        keys[this.foreignKey] = fromModel[this.from.keyName];
        keys[this.otherKey] = toModel[this.to.keyName];

        return this.pivot.where(keys).del();
    },

    save: function (fromModel, values) {
        if (arguments.length === 1) {
            return this.save(this.activeModel, fromModel);
        }

        var relation = this;

        return relation.to.save(values).then(function (toModels) {

            return relation.pivot.fork().whereRaw(
                '('+relation.foreignKey+','+relation.otherKey+') \
                in ('+toModels.map(function () { return '(?,?)'; }).join(',')+')',
                
                toModels.reduce(function (bindings, toModel) {
                    bindings.push(fromModel[relation.from.keyName])
                    bindings.push(toModel[relation.to.keyName]);
                    return bindings;
                }, [])
            ).all().then(function (pivots) {
                var idDict = relation.to.idDict(toModels);

                pivots.forEach(function (pivot) {
                    var toModel = idDict[pivot[relation.otherKey]];
                    if (toModel.pivot) {
                        _.extend(pivot, toModel.pivot);
                    }

                    toModel.pivot = pivot;
                });

                pivots = toModels.map(function (toModel) {
                    if (toModel.pivot && toModel.pivot[relation.pivot.keyName]) {
                        return toModel.pivot;
                    } else {
                        var stdPivot = {};
                        stdPivot[relation.foreignKey] = fromModel[relation.from.keyName];
                        stdPivot[relation.otherKey] = toModel[relation.to.keyName];

                        return stdPivot;
                    }
                });

                return relation.pivot.save(pivots).then(function () {
                    return toModels;
                });
            });
        });
    },

    update: function (fromModel, values) {
        if (arguments.length === 1) {
            return this.update(this.activeModel, fromModel);
        }

        return this.constraints(this.to)
            .where(this.pivot.c(this.foreignKey), '=', fromModel[this.from.keyName])
            .update(values);
    },

    del: function (fromModel) {
        if (arguments.length === 0) {
            return this.del(this.activeModel);
        }

        return this.constraints(this.to.fork())
            .where(this.pivot.c(this.foreignKey), '=', fromModel[this.from.keyName])
            .del();
    }
};