define('amd/combineplugin2/plugin', function () {
    return {
        load: function (esourceId, req, load, config) {
            load(true);
        }
    };
});

define('amd/combineplugin2/index', ['require', 'amd/combineplugin2/plugin'],function (require) {
    require('amd/combineplugin2/plugin');
    return {
        check: function () {
            return true;
        },

        name: 'amd/combineplugin2/index'
    };
});

require(['amd/combineplugin2/plugin'], function () {});