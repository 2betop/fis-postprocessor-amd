/**
 * @fileOverview 解析 js 中 amd 依赖。
 *
 * 功能介绍：
 *
 * 1. amd 包装 js 代码。如果已经 包装过则不包装。
 * 2. 给匿名 module 设置 module id.
 * 3. 添加同步和异步依赖到 map.json 文件里面。
 * 4. 依赖前置
 */
var lib = require('./lib/');
var pth = require('path');

// 自定义的 module id 表。
// key : module id.
// value: file.subpath
var map = {};

// 将正则特殊字符转义。
function pregQuote (str, delimiter) {
    return (str + '').replace(new RegExp('[.\\\\+*?\\[\\^\\]$(){}=!<>|:\\' + (delimiter || '') + '-]', 'g'), '\\$&');
}

var inited = false;
function init(conf) {

    // 避免重复执行。
    if (inited) {
        return;
    }

    // 左分隔符
    var ld = conf.left_delimiter ||
            fis.config.get('settings.template.left_delimiter') || '{%';

    // 右分隔符
    var rd = conf.right_delimiter ||
            fis.config.get('settings.template.right_delimiter') || '%}';

    // 正则特殊字符转义
    ld = pregQuote(ld);
    rd = pregQuote(rd);

    var reg;

    // smarty script tag
    reg = new RegExp('('+ld+'script(?:\\s+[\\s\\S]*?["\'\\s\\w\\/]'+rd+'|\\s*'+rd+'))([\\s\\S]*?)(?='+ld+'\\/script'+rd+'|$)', 'ig');
    parser.scriptsReg.push(reg);


    // swig script tag
    reg = new RegExp('('+ld+'\\s*script\\s+[\\s\\S]*?\\s*' +
            rd + ')([\\s\\S]*?)(?=' + ld + '\\s*endscript\\s*' +
            rd + '|$)', 'ig');

    parser.scriptsReg.push(reg);

    // 其他标签，请通过 exports.scriptsReg 扩展。

    // 用户也可以扩展，读取用户自定义脚本正则。
    if (conf.scriptsReg) {
        if (Array.isArray(conf.scriptsReg)) {
            parser.scriptsReg.push.apply(parser.scriptsReg, conf.scriptsReg);
        } else {
            parser.scriptsReg.push(conf.scriptsReg);
        }
    }

    if (conf.genAsyncDeps) {
        require('./lib/fis-prepackager-async-deps.js');
    }

    inited = true;
}

var parser = module.exports = function(content, file, conf) {
    
    init(conf);

    file.extras = file.extras || {};

    // 异步依赖
    file.extras.async = file.extras.async || [];

    // 同步依赖表，  module id: map id
    file.extras.paths = file.extras.paths || {};

    // 异步依赖表,  module id: map id
    file.extras.asyncPaths = file.extras.asyncPaths || {};

    if (file.isHtmlLike) {
        content = parser.parseHtml(content, file, conf);
    } else if (file.rExt === '.js') {
        content = parser.parseJs(content, file, conf);
    }

    // 减少 map.json 体积，把没用的删了。
    file.extras.async.length || (delete file.extras.async);
    isEmptyObject(file.extras.paths) && (delete file.extras.paths);
    isEmptyObject(file.extras.asyncPaths) && (delete file.extras.asyncPaths);
    isEmptyObject(file.extras) && (delete file.extras);

    return content;
};

// 只需把 html 中的 script 找出来，然后执行  parserJs。
parser.parseHtml = function(content, file, conf) {
    parser.scriptsReg.forEach(function(reg) {
        content = content.replace(reg, function(m, $1, $2) {
            
            // in <script> tag
            if ($1) {
                m = $1 + parser.parseJs($2, file, conf);
            }

            return m;
        });
    });

    return content;
};

// 插件默认配置项。
parser.defaultOptions = {
    // 是否把 amd define 定义模块依赖提前。
    forwardDeclaration: true,

    // 是否生成依赖表。
    genAsyncDeps: true,

    // 总开关，是否把全局环境下的 require([xxx], cb); 写法当成同步，提前加载依赖。
    globalAsyncAsSync: true,
    
    // module id 模板
    moduleIdTpl: '${namespace}${subpathNoExt}',

    // 用于定位模块文件用的.
    baseUrl: '.',
    paths: {},
    packages: []
};

// 默认 script 正则
parser.scriptsReg = [
    /(<script(?:\s+[\s\S]*?["'\s\w\/]>|\s*>))([\s\S]*?)(?=<\/script>|$)/ig
];

// like array.splice
function strSplice(str, index, count, add) {
    return str.slice(0, index) + add + str.slice(index + count);
}

function findPkg(pkg, list) {
    var i = 0;
    var len = list.length;


    for (; i < len; i++) {
        if (list[i].name === pkg) {
            return list[i];
        }
    }

    return null;
}

// 查找 module id.
// 具体请查看 https://github.com/amdjs/amdjs-api/blob/master/CommonConfig.md
// 
// 目前以下配置项是有效的。
//  paths
//  baseUrl
//  packages 
function resolveModuleId(id, dirname, conf) {
    var paths = conf.paths || {};
    var pkgs = conf.packages || [];
    var baseUrl = conf.baseUrl || '';
    var root = fis.project.getProjectPath();
    var isAlias = false;

    var info, m, pkg, path, dirs, item, dir, i, len;

    var idx = id.indexOf(':');
    var ns, subpath;
    if (~idx && (ns = id.substring(0, idx)) && ns == fis.config.get('namespace')) {
        subpath = id.substring(idx + 1);

        info = fis.uri(subpath, root);
        info.file || (info = fis.uri(subpath + '.js', root));
    } else if (id[0] === '.') {
        
        // 相对路径
        info = fis.uri(id, dirname);
        info.file || (info = fis.uri(id + '.js', dirname));
    } else if (id[0] === '/') {
        
        // 绝对路径。
        id = id.substring(1);
        info = fis.uri(id, root);
        info.file || (info = fis.uri(id + '.js', root));
    } else if ((m = /^([^\/]+)(?:\/(.*))?$/.exec(id))) {
        pkg = m[1];
        path = m[2] || '';

        // 先查找 conf.paths
        if (paths[pkg]) {
            dirs = paths[pkg];

            Array.isArray(dirs) || (dirs = [dirs]);
            
            for (i = 0, len = dirs.length; i < len; i++) {
                dir = dirs[i];

                if (dir[0] !== '/') {
                    dir = pth.join(baseUrl, dir);
                }

                if (path) {
                    info = fis.uri(path, dir);
                    info.file || (info = fis.uri(path + '.js', dir));
                } else {
                    info = fis.uri(dir, root);
                }
            }

        // 再查找 conf.packages
        } else if ((item = findPkg(pkg, pkgs))) {
            dir = baseUrl;
            if (dir[0] !== '/') {
                dir = pth.join(root, dir);
            }

            dir = pth.join(dir, item.location || item.name);
            path = path || item.main || 'main';
            info = fis.uri(path, dir);            
            info.file || (info = fis.uri(path + '.js', dir));
        }

        // 标记，是通过 pkg 或者 paths 查找到文件的。
        isAlias = true;
    }

    return {
        isAlias: info && info.file && isAlias,
        file: info && info.file
    }
}


parser.parseJs = function(content, file, conf) {
    var modules = lib.getAMDModules(content);
    var suffix = '';
    var diff, converter, requires;

    // 没找到 amd 定义, 则需要包装
    if (!modules.length && !file.isHtmlLike && (file.isMod || conf.wrapAll)) {
        content = wrapAMD(content, file, conf);
        modules = lib.getAMDModules(content);
    }

    converter = getConverter(content);
    diff = 0;

    file._anonymousDefineCount = file._anonymousDefineCount || 0;
    
    // 编译所有模块定义列表
    modules.forEach(function(module) {
        var argsRaw = [];
        var deps = [];
        var args = [];
        var moduleId, start, end, params;
        
        params = module.factory.params;
        params && params.forEach(function(param) {
            argsRaw.push(param.name);
        });

        // deps 是指 define 的第二个参数中指定的依赖列表。
        if (module.deps && module.deps.length) {

            // 添加依赖。
            module.deps.forEach(function(elem) {
                var v = elem.raw;
                var info = fis.util.stringQuote(v);
                var target, moduleId;

                v = elem.value;

                // 不需要查找依赖，如果是 require、module、或者 exports.
                if (~'require,module,exports'.indexOf(v)) {
                    deps.push(elem.raw);
                    args.push(argsRaw.shift());
                    return;
                }

                target = resolveModuleId(v, file.dirname, conf);

                if (target && target.file) {
                    file.addRequire(target.file.id);
                    compileFile(target.file);
                    moduleId = getModuleId(v, target.file, conf );

                    file.extras.paths[moduleId] = target.file.id;

                    deps.push(info.quote + moduleId + info.quote);
                    args.push(argsRaw.shift());
                } else {
                    fis.log.warning('Can not find module `' + v + '`');
                }
            });
        } else {
            args = argsRaw.concat();
        }

        // module 中的 require(string) 列表。
        if (module.syncRequires && module.syncRequires.length) {

            module.syncRequires.forEach(function(item) {
                var elem = item.node.arguments[0];
                var v = elem.value;
                var info = fis.util.stringQuote(elem.raw);
                var target, moduleId, val, start, end;

                target = resolveModuleId(v, file.dirname, conf);

                if (target && target.file) {
                    file.removeRequire(v);
                    file.addRequire(target.file.id);
                    compileFile(target.file);
                    moduleId = getModuleId(v, target.file, conf );
                    file.extras.paths[moduleId] = target.file.id;

                    start = converter(elem.loc.start.line, elem.loc.start.column) + diff;
                    diff += moduleId.length - elem.value.length;
                    content = strSplice(content, start, elem.raw.length, info.quote + moduleId + info.quote);

                    // 非依赖前置
                    if (!conf.forwardDeclaration) {
                        return;
                    }
                } else {
                    fis.log.warning('Can not find module `' + v + '`');
                }

                deps.push(info.quote + moduleId + info.quote);
            });

            // define(function(require) {
            //      var a = require('a');
            //      var b = require('b');
            // });
            // 
            // define(['require', 'exports', 'module'], function(require, exports) {
            //      var a = require('a');
            //      var b = require('b');
            // });
            // 
            if (conf.forwardDeclaration) {

                if (!args.length) {
                    args.push('require');
                }

                if (args[0] === 'require' && deps[0].substring(1, 8) !== 'require') {
                    deps.unshift('\'require\'');
                }

                if (args[1] === 'exports' && deps[1].substring(1, 8) !== 'exports') {
                    deps.splice(1, 0, '\'exports\'');
                }

                if (args[2] === 'module' && deps[2].substring(1, 7) !== 'module') {
                    deps.splice(2, 0, '\'module\'');
                }
            }
        }
        

        // 替换 factory args.
        if (args.length) {
            if (params.length) {
                start = converter(params[0].loc.start.line, params[0].loc.start.column);
                end = converter(params[params.length - 1].loc.end.line, params[params.length - 1].loc.end.column);
            } else {
                start = converter(module.factory.loc.start.line, module.factory.loc.start.column);
                end = converter(module.factory.loc.end.line, module.factory.loc.end.column);
                start += /^function[^\(]*\(/i.exec(content.substring(start, end))[0].length;
                end = start;
            }

            content = strSplice(content, start, end - start, args.join(', '));
        }

        // 替换 deps
        if (deps.length) {
            start = converter(module.depsLoc.start.line, module.depsLoc.start.column);
            end = converter(module.depsLoc.end.line, module.depsLoc.end.column);

            content = strSplice(content, start, end - start, '[' + deps.join(', ') + ']' + (module.deps ? '' : ','))
        }

        // 添加 module id
        if (!module.id) {
            
            if (file._anonymousDefineCount) {
                fis.log.error('The file has more than one anonymous ' +
                        'define');
                return;
            }

            moduleId = getModuleId('', file, conf);
            start = module.node.loc.start;
            start = converter(start.line, start.column);
            start += /^define\s*\(/.exec(content.substring(start))[0].length;
            content = strSplice(content, start, 0, '\''+moduleId+'\', ');
            file._anonymousDefineCount++;
        } else {
            // 自动填充 conf.paths 表。
            map[module.id] = map[module.id] || file.subpath;
        }
    });

    // console.log(content);


    // 获取文件中异步 require
    // require([xxx], callback);
    requires = lib.getAsyncRequires(content);

    if (requires.length) {
        converter = getConverter(content);

        diff = 0;
        requires.forEach(function(req) {

            // 只有在模块中的异步才被认为是异步？
            // 因为在 define 外面，没有这样的用法： var lib = require('string');
            // 
            // 这块逻辑待商定！！！！！
            var async = !conf.globalAsyncAsSync || req.isInModule;

            (req.deps || []).forEach(function(elem) {
                var v = elem.raw;
                var info = fis.util.stringQuote(v);
                var target, start, moduleId;

                v = info.rest.trim();
                target = resolveModuleId(v, file.dirname, conf);

                if (target && target.file) {
                    compileFile(target.file);
                    moduleId = getModuleId(v, target.file, conf );

                    if (async) {
                        if (!~file.extras.async.indexOf(target.file.id) && !~file.requires.indexOf(target.file.id)) {
                            file.extras.async.push(target.file.id);
                        }

                        file.extras.asyncPaths[moduleId] = target.file.id;
                    } else {
                        file.extras.paths[moduleId] = target.file.id;
                        file.addRequire(target.file.id);
                    }
                    
                    start = elem.loc.start;
                    start = converter(start.line, start.column) + diff;

                    diff += moduleId.length - elem.value.length;
                    content = strSplice(content, start, elem.raw.length, info.quote + moduleId + info.quote);
                   
                } else {
                    fis.log.warning('Can not find module `' + v + '`');
                }
            });

        });
    }

    return content + suffix;
};

// 避免嵌套 compile
var hash = {};
function compileFile( file ) {
    var id = file.realpath;

    if (hash[id]) {
        return;
    } else if (file.compiled) {
        return;
    }

    hash[id] = true;
    fis.compile(file);
    delete hash[id];
}

function getKeyByValue(obj, val) {
    var keys = Object.keys(obj);
    var len = keys.length;
    var i = 0;
    var key;

    if (!val) {
        return null;
    }

    for (; i < len; i++) {
        key = keys[i];
        if (obj[key] === val) {
            return key;
        }
    }

    return null;
}

function getModuleId(ref, file, conf) {
    var key;

    // 
    if (ref) {
        if (ref[0] !== '.' && ref[0] !== '/' && map[ref]) {
            return ref;
        } else if ((key = getKeyByValue(map, file.subpath))) {
            return key;
        }
    }

    if (conf.moduleIdTpl) {
        return conf.moduleIdTpl.replace(/\$\{([^\}]+)\}/g, function(all, $1){
            var val = file[$1] || fis.config.get($1);

            if (typeof val === 'undefined') {
                fis.log.error('undefined property [' + $1 + '].');
            } else {
                return val;
            }

            return all;
        });
    } else {
        return file.moduleId || file.id;
    }
};

var getConverter = function(content) {
    var rbr = /\r\n|\r|\n/mg;
    var steps = [0], m;

    while((m = rbr.exec(content))) {
        steps.push(m.index + m[0].length);
    }

    return function(line, column) {
        if (steps.length < line) {
            return -1;
        }

        return steps[line-1] + column;
    };
};

function wrapAMD(content, file, conf) {
    var moduleId = getModuleId('', file, conf);

    content = 'define(\'' + moduleId + '\', function(require, exports, module) {\n' + content + '\n});';

    return content;
}

function isEmptyObject(obj) {

    for (var key in obj) {
        return false;
    }

    return true;
}