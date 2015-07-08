module.exports = function (ioredis) {

    ioredis.defineCommand('cleanup', {
        numberOfKeys: 0,
        lua: '\
            local keys = redis.call("keys", ARGV[1]) \n\
            for i=1,#keys,5000 do \n\
                redis.call("del", unpack(keys, i, math.min(i+4999, #keys))) \n\
            end \n\
            return keys'
    });

};