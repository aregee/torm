var _ = require('lodash');

module.exports = Track;

function Track(scopes) {
    if (! _.isArray(scopes)) {
        scopes = [];
    }

    function track(q) {
        track.scopes.forEach(function (s) {
            s(q);
        });

        return q;
    };

    track.scopes = scopes;

    track.__proto__ = Track.methods;
    track.__proto__.constructor = Track;

    return track;
};

Track.methods = {
    push: function (scope) {
        if (scope.isJoint && this.hasJoint(scope.label)) {
            return this;
        } else {
            this.scopes.push(scope);
            return this;
        }
    },

    hasJoint: function (label) {
        var i = _.pluck(this.scopes, 'label').indexOf(label);
        return i > -1 && this.scopes[i].isJoint;
    },

    rewind: function () {
        this.scopes.pop();
        return this;
    },

    fork: function () {
        return Track(this.scopes.slice(0));
    },

    merge: function (track) {
        this.scopes.concat(track.scopes);
        return this;
    },

    relabelLastScope: function (name) {
        this.scopes.slice(-1)[0].label = name;
        return this;
    }
};