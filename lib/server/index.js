var express = require('express');
var derby = require('derby');
var racerBrowserChannel = require('racer-browserchannel');
var liveDbMongo = require('livedb-mongo');
var MongoStore = require('connect-mongo')(express);
var app = require('../app');
var error = require('./error');
var async = require('async');
var request = require('request');
var livebet = require('../livebet')

var expressApp = module.exports = express();

// Get Redis configuration
var redis = require('redis').createClient();

// Get Mongo configuration
var mongoUrl = 'mongodb://localhost:27017/project';

// The store creates models and syncs data
var store = derby.createStore({
    db: liveDbMongo(mongoUrl + '?auto_reconnect', {safe: true}), redis: redis
});

var xml2js = require('xml2js');
var parseString = new xml2js.Parser({explicitArray: false}).parseString;

var inspect = require('eyes').inspector({maxLength: false});

function updateLocalUser(req, res, next) {
    req.session.userData = req.user;
    req.getModel().set('_session.userData', req.session.userData);
    next();
}

function doBasicAuth(user, pass, callback) {
    request({
        'url': 'https://api.nordicbet.com/eng/users/login',
        'auth': {
            'user': user,
            'pass': pass
        }
    }, function (error, response, body) {
        if (error || response.statusCode != 200) {
            callback(false, null);
        } else {
            parseString(body, function (err, result) {
                callback(err, result);
            });
        }
    });
}

function restoreLocalUser(req, res, next) {
    req.user = req.session.userData;
    next();
}


expressApp
    .use(express.favicon())
    // Gzip dynamically
    .use(express.compress())
    // Respond to requests for application script bundles
    .use(app.scripts(store))
    // Serve static files from the public directory
    // .use(express.static(__dirname + '/../../public'))

    // Add browserchannel client-side scripts to model bundles created by store,
    // and return middleware for responding to remote client messages
    .use(racerBrowserChannel(store))
    // Add req.getModel() method
    .use(store.modelMiddleware())

    // Parse form data
    // .use(express.bodyParser())
    // .use(express.methodOverride())

    // Session middleware
    .use(express.cookieParser())
    .use(express.session({
        secret: 'uln1Tkd4V7VALUowzG1hIlCHVqPI4jkCg7M',
        store: new MongoStore({url: mongoUrl, safe: true})
    }))
    .use(restoreLocalUser)
    .use(express.basicAuth(doBasicAuth, 'nordicbet.com user/pass'))
    .use(updateLocalUser)

    // Create an express middleware from the app's routes
    .use(app.router())
    .use(expressApp.router)
    .use(error())


// SERVER-SIDE ROUTES //

expressApp.all('*', function (req, res, next) {
    next('404: ' + req.url);
});

var model = store.createModel();

function startFetchingLivebetGamesList() {
    console.log('Fetching livebet list...');
    request('https://api.nordicbet.com/eng/games/livebet',
        function (error, response, body) {
            if (!error && response.statusCode == 200) {
                parseString(body, function (err, result) {
                    var ids = [];
                    result.GameList.Game.forEach(function (g) {
                        var id = g.$.game_id;
                        ids.push(id);
                    });

                    if(ids.length > 5) {
                        ids.length = 5;
                    }

                    // fetch additional info for each game id
                    async.parallel(ids.map(function (id) {
                        return function (callback) {
                            request('https://api.nordicbet.com/eng/games/' + id,
                                function (err, response, body) {
                                    if (!err && response.statusCode == 200) {
                                        parseString(body, function (err, result) {
                                            if (err) {
                                                callback(err);
                                            } else {
                                                callback(null, {
                                                    id: id,
                                                    name: result.Game.Name,
                                                    sport: result.Game.Sport,
                                                    region: result.Game.Region
                                                });
                                            }
                                        });
                                    } else {
                                        callback(err)
                                    }
                                });
                        }
                    }), function (err, results) {
                        model.set('games.livebet', results);
                        results.forEach(function (game, index) {
                            livebet.subscribe(model.at('games.livebet.' + index));
                        });
                    });
                });
            }
        });
}

model.subscribe('games', function () {
    model.destroy('games');
    model.set('games.livebet', null);

    startFetchingLivebetGamesList();
});
