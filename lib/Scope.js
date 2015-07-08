module.exports = Scope;

function Scope(closure, label, isJoint) {
    function scope(q) {
        return closure(q);
    };

    scope.label = label;
    scope.isJoint = !!isJoint;

    scope.__proto__.constructor = Scope;

    return scope;
};