/*
db.Table({
    tableName: 'fizz',

    joints: {
        joinTagsPivot: function () {
            return this.joint(function (q) {
                q.join('...', '..', '..', '..');
            });
        },

        joinTags: function () {
            return this.joinTagsPivot().joint(function (q) {
                q.join('...', '..', '..', '..');
            });
        }
    },

    scopes: {
        // set scopes and joints here
        // these are various scopes and joints that
        forTags: function (tagIds) {
            return this.joinTags().scope(function (q) {
                q.whereIn('tags.tag_id', tagIds);
            });
        }
    },

    methods: {
        // other methods that you might need on a table
    }
})

var Post = orm('posts');
var Tag = orm('tags');

Post.where('published_at', '>', moment.lastMonth())
    .joinTags().where(db('tags').c('id'), 'in', tagIds)
    .cache(5000)
    .all(function (posts) {
        
    });

Post.scopePopular().limit(3).all(function (posts) {
    
}).then(function () {
    
})

*/
var _       = require('lodash');
var Promise = require('bluebird');
var md5     = require('MD5');
var uuid    = require('uuid');

var config = appRequire('config');

var Track = require('./Track');
var Scope = require('./Scope');

var HasOne         = require('./relations/HasOne');
var HasMany        = require('./relations/HasMany');
var HasManyThrough = require('./relations/HasManyThrough');
var BelongsTo      = require('./relations/BelongsTo');
var BelongsToMany  = require('./relations/BelongsToMany');
var MorphOne       = require('./relations/MorphOne');
var MorphMany      = require('./relations/MorphMany');
var MorphTo        = require('./relations/MorphTo');

module.exports = Table;

function Table(db, options) {
    var table = function (tableName) {
        return table.table(tableName);
    };

    // go below to see Table.methods
    table.__proto__ = Table.methods;
    table.__proto__.constructor = Table;
    
    table.db = db;

    table.knex = db.knex;
    
    table.scopeTrack = Track();

    table.relations = [];

    _.extend(table, {
        tableName       : options.tableName,
        keyName         : options.keyName || 'id',
        autoIncrementing: !!options.autoIncrementing,
        perPage         : options.perPage || 25,
        usesTimestamps  : !!options.usesTimestamps,
        dateTimes       : options.dateTimes || [],
        timestamps      : options.timestamps || {
            createdAt: 'created_at', updatedAt: 'updated_at'
        },
        rowParser       : options.rowParser || function (row) {
            return row;
        },
        collectionParser: options.collectionParser || function (collection) {
            return collection;
        }
    });

    if (db.redis) {
        table._cache = db.redis.Hash(table.tableName);
    }

    if (table.usesTimestamps) {
        table.dateTimes.push('created_at');
        table.dateTimes.push('updated_at');
    }

    var hooks = _.transform(options.hooks || {}, function (result, hook, name) {
        hook = _.isFunction(hook) ? hook : table._hookFactory();
        result[name] = hook.bind(table);
        return result;
    }, {});

    _.extend(table, {
        beforeSave  : hooks.beforeSave,
        afterSave   : hooks.afterSave,
        
        beforeCreate: hooks.beforeCreate,
        afterCreate : hooks.afterCreate,
        
        beforeUpdate: hooks.beforeUpdate,
        afterUpdate : hooks.afterUpdate,

        beforeDelete: hooks.beforeDelete,
        afterDelete : hooks.afterDelete,
    });



    _.forEach(options.scopes || {}, function (scope, name) {
        table.addScope(name, scope);
    });

    _.forEach(options.joints || {}, function (joint, name) {
        table.addJoint(name, joint);
    });

    _.forEach(options.relations || {}, function (relation, name) {
        table.addRelation(name, relation);
    });

    _.forEach(options.methods || {}, function (method, name) {
        table[name] = method.bind(table);
    });


    table.getConstructorOptions = function () {
        return options;
    };

    return table;
};

Table.methods = {
    /**
     * return a promise of columns
     */
    columns: function () {
        if (this.db.columns[this.tableName]) {
            return Promise.resolve(_.keys(this.db.columns[this.tableName]));
        } else {
            return this.loadColumns().then(function (table) {
                return table.columns();
            });
        }
    },

    loadColumns: function () {
        return this.newQuery().columnInfo().then(function (columns) {
            this.db.columns[this.tableName] = columns;
            return this;
        }.bind(this));
    },

    /**
     * before/after save/create standard
     * hooks factory
     */
    _hookFactory: function () {
        return function (model) {
            return Promise.resolve(model);
        };
    },

    /**
     * helper methods to get column names and keys
     */
    c: function (col) {
        if (_.isArray(col)) {
            return col.map(this.c.bind(this));
        } else {
            if (_.isString(col)) {
                col = col.indexOf('.') > -1 ? col : this.tableName+'.'+col;
                col = col.indexOf('->') > -1 ? this.db.raw(col) : col;
            }

            return col;
        }
    },

    key: function () {
        return this.c(this.keyName);
    },

    /**
     * Scope and Joints and related methods
     */
    scope: function (scope, name) {
        this.scopeTrack.push(Scope(scope, name));
        return this;
    },

    joint: function (scope, name) {
        this.scopeTrack.push(Scope(scope, name, true));
        return this;
    },

    addScope: function (name, scope) {
        this[name] = function (args) {
            args = Array.prototype.slice.call(arguments, 0);
            scope.apply(this, args);
            // set the label of the last pushed scope
            this.scopeTrack.relabelLastScope(name);
            return this;
        }.bind(this);

        return this;
    },

    addJoint: function (name, joint) {
        // joints never take arguments
        this[name] = function () {
            if (this.scopeTrack.hasJoint(name)) {
                return this;
            }

            joint.call(this);
            // set the label of the last pushed scope
            this.scopeTrack.relabelLastScope(name);
            // ensure that the last scope is a joint
            this.scopeTrack.makeJointOfLastScope();
            return this;
        }.bind(this);

        return this;
    },

    addRelation: function (name, relation) {
        this.relations.push(name);
        this[name] = function (model) {
            if (arguments.length > 0) {
                return relation.bind(this)()(model);
            } else {
                return relation.bind(this)();
            }
        }.bind(this);

        return this;
    },

    fork: function () {
        var forkedTable = new Table(this.db, this.getConstructorOptions());
        forkedTable.scopeTrack = this.scopeTrack.fork();

        return forkedTable;
    },

    newQuery: function () {
        var q = this.knex(this.tableName);

        q._div = {
            cacheEnabled: false,
            cacheLifetime: null,
            destroyCache: false,

            columns: this.c('*'),

            trx: null,

            eagerLoads: {}
        };

        return q;
    },

    query: function (opts) {
        var q = this.newQuery();

        this.scopeTrack(q);

        if (opts && opts.count === true) {
            return q;
        } else {
            return q.select(q._div.columns);
        }
    },

    /**
     * helper method to refer to other tables in
     * methods. carries over the transaction which
     * is applied to this table, and also cache settings
     */
    table: function (tableName) {
        var q = this.query();

        var table = this.db(tableName);

        if (q._div.trx !== null) {
            table.transacting(q._div.trx);
        }

        if (q._div.cacheEnabled) {
            table.cache(q._div.cacheLifetime);
        }

        if (q._div.destroyCache) {
            table.uncache();
        }

        return table;
    },

    /**
     * Default Scopes
     */
    scopeNull: function () {
        return this.scope(function (q) {
            q.whereNull(this.key());
        }.bind(this), 'scopeNull');
    },

    where: function (field, op, val) {
        if (arguments.length === 1 && _.isObject(field)) {
            var conditions = field;
            _.forEach(conditions, function (val, key) {
                this.where(key, '=', val);
            }.bind(this));

            return this;
        }

        if (arguments.length === 2) {
            val = op;
            op = '=';
        }

        if (op.toLowerCase() === 'in') {
            return this.whereIn(field, val);
        } else if (op.toLowerCase() === 'not in') {
            return this.whereNotIn(field, val);
        } else if (op.toLowerCase() === 'between') {
            return this.whereBetween(field, val);
        }  else if (op.toLowerCase() === 'not between') {
            return this.whereNotBetween(field, val);
        } else {
            return this.scope(function (q) {
                q.where(this.c(field), op, val);
            }.bind(this), 'where');    
        }
    },

    whereNot: function (field, op, val) {
        if (arguments.length === 1 && _.isObject(field)) {
            var conditions = field;
            _.forEach(conditions, function (val, key) {
                this.whereNot(key, '=', val);
            }.bind(this));

            return this;
        }

        if (arguments.length === 2) {
            val = op;
            op = '=';
        }

        if (op.toLowerCase() === 'in') {
            return this.whereNotIn(field, val);
        } else if (op.toLowerCase() === 'not in') {
            return this.whereIn(field, val);
        } else if (op.toLowerCase() === 'between') {
            return this.whereNotBetween(field, val);
        }  else if (op.toLowerCase() === 'not between') {
            return this.whereBetween(field, val);
        } else {
            return this.scope(function (q) {
                q.whereNot(this.c(field), op, val);
            }.bind(this), 'whereNot');    
        }
    },

    whereIn: function (field, values) {
        if (values.length === 0) {
            return this.scopeNull();
        } else {
            return this.scope(function (q) {
                q.whereIn(this.c(field), values);
            }.bind(this), 'whereIn');
        }
    },

    whereNotIn: function (field, values) {
        if (values.length === 0) {
            return this;
        } else {
            return this.scope(function (q) {
                q.whereNotIn(this.c(field), values);
            }.bind(this), 'whereNotIn');
        }
    },

    whereNull: function (field) {
        return this.scope(function (q) {
            q.whereNull(this.c(field));
        }.bind(this), 'whereNull');
    },

    whereNotNull: function (field) {
        return this.scope(function (q) {
            q.whereNotNull(this.c(field));
        }.bind(this), 'whereNotNull');
    },

    whereBetween: function (field, range) {
        return this.scope(function (q) {
            q.whereBetween(this.c(field), range);
        }.bind(this), 'whereBetween');
    },

    whereNotBetween: function (field, range) {
        return this.scope(function (q) {
            q.whereNotBetween(this.c(field), range);
        }.bind(this), 'whereNotBetween');
    },

    whereRaw: function (query, bindings) {
        return this.scope(function (q) {
            q.whereRaw(query, bindings);
        }, 'whereRaw');
    },

    transacting: function (trx) {
        return this.scope(function (q) {
            q._div.trx = trx;
            q.transacting(trx);
        }.bind(this), 'transacting');
    },

    forPage: function (page, perPage) {
        page = parseInt(page);
        page = page < 1 ? 1 : page;
        perPage = perPage || this.perPage;

        var limit = perPage;
        var offset = ((page - 1) * perPage);

        return this.scope(function (q) {
            q.limit(limit).offset(offset);
        }, 'forPage');
    },

    offset: function (offset) {
        return this.scope(function (q) {
            q.offset(offset);
        }, 'offset');
    },

    take: function (limit) {
        return this.scope(function (q) {
            q.limit(limit);
        }, 'take');
    },

    orderBy: function (field, direction) {
        return this.scope(function (q) {
            q.orderBy(field, direction);
        }, 'orderBy');
    },

    // lifetime is in milliseconds
    cache: function (lifetime) {
        return this.scope(function (q) {
            q._div.cacheEnabled = true;
            q._div.cacheLifetime = lifetime;
        }, 'cache');
    },

    select: function (cols) {
        return this.scope(function (q) {
            q._div.columns = this.c(cols);
        }.bind(this), 'select')
    },

    uncache: function () {
        return this.scope(function (q) {
            q._div.destroyCache = true;
        }, 'uncache');
    },

    eagerLoad: function (args) {
        if (_.isArray(args)) {
            var eagerLoads = this._parseEagerLoads(args);
        } else if (_.isObject(args)) {
            var eagerLoads = args;
        } else {
            return this;
        }

        return this.scope(function (q) {
            _.assign(q._div.eagerLoads, eagerLoads);
        }, 'eagerLoad');
    },

    _stdConstraint: function () {
        return function () {};
    },

    _parseEagerLoads: function (args) {
        if (! _.isArray(args)) {
            args = Array.prototype.slice.call(args, 0);
        }

        var stdConstraint = this._stdConstraint;

        var eagerLoads = _.reduce(args, function (eagers, arg) {
            if (_.isString(arg)) {
                var relation = arg;
                var constraint = stdConstraint();
            } else if (_.isObject(arg)) {
                var relation = _.keys(arg)[0];
                var constraint = _.values(arg)[0];
            }

            var parts = [];

            if (relation.indexOf('.') > -1) {
                parts = _.reduce(relation.split('.'), function (parsed, part) {
                    parsed.push(parsed.slice(-1).concat([part]).join('.'));
                    return parsed;
                }, []);

                parts = parts.map(function (part) {
                    var o = {};

                    if (relation === part) {
                        o[part] = constraint;
                    } else {
                        o[part] = stdConstraint();
                    }

                    return o;
                });
            } else {
                var o = {};
                o[relation] = constraint;
                parts.push(o);
            }

            parts.forEach(function (part) {
                var relation = _.keys(part)[0];
                var constraint = _.values(part)[0];

                if (eagers[relation]) {
                    if (constraint.toString() !== stdConstraint().toString()) {
                        eagers[relation] = constraint;
                    }
                } else {
                    eagers[relation] = constraint;
                }
            });

            return eagers;
        }, {});

        return eagerLoads;
    },

    /**
     * cache management methods
     */
    _queryKey: function (q) {
        return md5(q.toString());
    },

    _processCache: function (q, opts) {
        var table = this;

        if (q._div.destroyCache) {
            var key = table._queryKey(q);
            return table._cache.del(key).then(function () {
                q._div.destroyCache = false;
                return table._processCache(q, opts);
            });
        }

        if (q._div.cacheEnabled) {
            var key = table._queryKey(q);

            return table._cache(key).then(function (result) {
                if (result === null) {
                    return q.then(function (result) {
                        if (opts && opts.count === true) {
                            result = result[0].count;
                        }

                        return table._cache(key, result, q._div.cacheLifetime)
                            .then(function () {
                                return table._processResult(result);
                            }).then(function (result) {
                                return table._loadRelations(result, q._div.eagerLoads);
                            });
                    });
                } else {
                    result = table._processResult(result);
                    return table._loadRelations(result, q._div.eagerLoads);
                }
            });
        } else {
            if (opts && opts.count === true) {
                return q.then(function (result) {
                    return result[0].count;
                })
            } else {
                return q.then(function (result) {
                    result = table._processResult(result);
                    return table._loadRelations(result, q._div.eagerLoads);
                });
            }
        }
    },

    clearCache: function () {
        return this._cache.clear();
    },

    /**
     * result processing and relation loading
     */
    _processResult: function (result) {
        if (_.isArray(result)) {
            return this.collectionParser(result.map(this._processResult.bind(this)));
        } else if (_.isObject(result)) {
            result = _.transform(result, function (result, val, key) {
                if (key.indexOf('.') > -1 && key.indexOf(this.tableName) === 0) {
                    result[key.split('.')[1]] = val;
                } else {
                    result[key] = val;
                }

                return result;
            }.bind(this));

            return this.rowParser(result);
        } else {
            return result;
        }
    },

    _loadRelations: function (result, eagerLoads) {
        if (_.isArray(result) && result.length === 0) {
            return Promise.resolve(result);
        } else if (!!result === false) {
            return Promise.resolve(result);
        }

        var eagerLoadables = _.keys(eagerLoads).filter(function (relation) {
            return relation.indexOf('.') === -1
        });

        return Promise.all(eagerLoadables.map(function (relationName) {
            relation = this[relationName]();
            relation.eagerLoad(this.subEagerLoads(relationName, eagerLoads));
            relation.constrain(eagerLoads[relationName]);
            return relation.load(result, relationName);
        }.bind(this))).then(function () {
            return result;
        });
    },

    subEagerLoads: function (relation, eagerLoads) {
        return _.transform(eagerLoads, function (sub, constraint, relationName) {
            if (relationName.indexOf(relation) === 0 && relationName !== relation) {
                var subRelation = relationName.split('.').slice(1).join('.');
                sub[subRelation] = constraint;
            }

            return sub;
        }, {});
    },

    /**
     * data retrieval methods
     */
    first: function () {
        return this._processCache(this.query().first());
    },

    all: function () {
        return this._processCache(this.query().distinct());
    },

    idDict: function (models, key) {
        if (arguments.length === 0) {
            return this.all().then(function (models) {
                return this.idDict(models);
            }.bind(this));
        }

        var idDict = {};
        key = key || this.keyName;
        
        models.forEach(function (m) {
            idDict[m[key]] = m;
        }.bind(this));

        return idDict;
    },

    count: function () {
        return this._processCache(
            this.query({count: true}).count(this.key()),
            {count: true}
        ).then(function (result) {
            return parseInt(result);
        });
    },

    find: function (args) {
        var args = Array.prototype.slice.call(arguments, 0);

        if (args.length === 1) {
            return this.where(this.key(), '=', args[0]).first();
        } else {
            return this.where(args[0], '=', args[1]).first();
        }
    },

    exists: function (value) {
        if (_.isObject(value)) {
            var q = this.where(this.key(), '=', value[this.keyName]).count();
        } else {
            var q = this.where(this.key(), '=', value).count();
        }
        
        return q.then(function (result) {
            return result > 0;
        });
    },

    /**
     * helper method to get a new uuid
     */
    newKey: function () {
        var id = uuid();
        return this.exists(id).then(function (exists) {
            if (exists) {
                return this.newKey();
            } else {
                return id;
            }
        }.bind(this));
    },

    /**
     * data mutation methods
     */
    update: function (args) {
        args = Array.prototype.slice.call(arguments, 0);

        if (args.length === 1) {
            return this.query().update(args[0]);
        } else {
            return this.where(this.key(), '=', args[0]).update(args[1]);
        }
    },

    del: function (args) {
        args = Array.prototype.slice.call(arguments, 0);

        if (args.length === 0) {
            return this.query().del();
        } else if (_.isObject(args[0])) {
            var model = args[0];
            return this.beforeDelete(model).then(function (model) {
                return this.where(this.key(), model[this.keyName]).del()
                    .then(function (){
                        return model;
                    });
            }.bind(this)).then(this.afterDelete.bind(this));
        } else {
            // here we assume that args[0] is our key
            return this.where(this.key(), args[0]).del();
        }
    },

    truncate: function () {
        return this.query().truncate();
    },

    insert: function (values) {
        var table = this;

        if (table.usesTimestamps) {
            var timestamp = new Date;
            
            if (! (values[table.timestamps.createdAt] instanceof Date)) {
                values[table.timestamps.createdAt] = timestamp;
            }

            if (! (values[table.timestamps.updatedAt] instanceof Date)) {
                values[table.timestamps.updatedAt] = timestamp;
            }
        }

        if (table.autoIncrementing) {
            return table.newQuery().returning(table.keyName)
                .insert(values)
                .then(function (id) {
                    values[table.keyName] = id;
                    return values;
                })
        } else {
            return table.newQuery().insert(values).then(function (result) {
                values[table.keyName] = result[0];
                return values;
            });
        }
    },

    /**
     * model persistence methods
     */
    updateModel: function (model, existing) {
        var table = this;
        var timestamp = new Date;

        return table.beforeUpdate(model).then(function (model) {
            return Promise.props({
                model: Promise.resolve(model),
                columns: table.columns()
            });
        }).then(function (data) {
            var model = data.model;
            var columns = data.columns;

            var values = {};

            columns.forEach(function (col) {
                var oldJSON = JSON.stringify(existing[col]);
                var newJSON = JSON.stringify(model[col]);
                if (oldJSON !== newJSON) {
                    values[col] = model[col];
                }
            });

            if (_.keys(values).length === 0) {
                return Promise.resolve(model);
            } else {
                
                if (table.usesTimestamps) {
                    if (! (values[table.timestamps.updatedAt] instanceof Date)) {
                        values[table.timestamps.updatedAt] = timestamp;
                    }
                }

                return table.newQuery()
                    .where(table.key(), '=', model[table.keyName])
                    .update(values)
                    .then(function (result) {
                        return model;
                    })
                ;
            }
        }).then(table.afterUpdate.bind(table));
    },

    createModel: function (model) {
        var table = this;
        var timestamp = new Date;

        return table.beforeCreate(model).then(function (model) {
            return Promise.props({
                model: Promise.resolve(model),
                columns: table.columns()
            })
        }).then(function (data) {
            var model = data.model;
            var columns = data.columns;

            if (table.usesTimestamps) {
                if (! (model[table.timestamps.createdAt] instanceof Date)) {
                    model[table.timestamps.createdAt] = timestamp;
                }

                if (! (model[table.timestamps.updatedAt] instanceof Date)) {
                    model[table.timestamps.updatedAt] = timestamp;
                }
            }

            var values = {};
            columns.forEach(function (col) {
                if (! (table.autoIncrementing && col === table.keyName)) {
                    values[col] = model[col];
                }
            });

            if (table.autoIncrementing) {
                return table.newQuery().returning(table.keyName)
                    .insert(values)
                    .then(function (result) {
                        model[table.keyName] = result[0];
                        return model;
                    });
            } else {
                return table.newKey().then(function (id) {
                    values[table.keyName] = id;
                    return table.newQuery().insert(values).then(function () {
                        model[table.keyName] = id;
                        return model;
                    });
                });                    
            }
        }).then(table.afterCreate.bind(table));
    },

    saveModel: function (model) {
        var table = this;
        
        return table.beforeSave(model)
            .then(function (model) {
                return table.newQuery()
                    .where(table.key(), '=', model[table.keyName])
                    .first()
                    .then(function (existing) {
                        if (existing) {
                            return table.updateModel(model, existing);

                        } else {
                            return table.createModel(model);
                        }
                    });
            }).then(table.afterSave.bind(table));
    },

    save: function (value) {
        if (_.isArray(value)) {
            return Promise.all(value.map(function (val) {
                return this.save(val);
            }.bind(this)));
        } else {
            return this.saveModel(value);
        }    
    },

    /**
     * relationships
     */
    hasOne: function (related, foreignKey, key) {
        key = key || this.keyName;
        
        return HasOne(this.fork(), this(related), foreignKey, key);
    },

    hasMany: function (related, foreignKey, key) {
        key = key || this.keyName;

        return HasMany(this.fork(), this(related), foreignKey, key);
    },

    hasManyThrough: function (related, through, firstKey, secondKey) {
        return HasManyThrough(
            this.fork(), this(related), this(through), firstKey, secondKey
        );
    },

    belongsTo: function (related, foreignKey, otherKey) {
        related = this(related);
        otherKey = otherKey || related.keyName;

        return BelongsTo(this.fork(), related, foreignKey, otherKey);
    },

    belongsToMany: function (related, pivot, foreignKey, otherKey) {
        return BelongsToMany(
            this.fork(), this(related), this(pivot), foreignKey, otherKey
        );
    },

    morphOne: function (related, inverse) {
        related = this(related);
        
        return MorphOne(this.fork(), related, related[inverse]());
    },

    morphMany: function (related, inverse) {
        related = this(related);
        
        return MorphMany(this.fork(), related, related[inverse]());
    },

    morphTo: function (tables, typeField, foreignKey) {
        tables = tables.map(function (t) {
            return this(t);
        }.bind(this));

        return MorphTo(this.fork(), tables, typeField, foreignKey);
    },

    /**
     * relation helpers
     */
    joinRelation: function (relationName) {
        return this[relationName]().join(this, relationName);
    },

    joinPivot: function (relationName) {
        return this[relationName]().join(this, relationName)
    }
};