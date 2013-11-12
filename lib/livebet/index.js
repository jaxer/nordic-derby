var host = 'lb.nordicbet.com';
var port = 8007;

var xml2js = require('xml2js');
var parseString = new xml2js.Parser().parseString;

var carrier = require('carrier');

var inspect = require('eyes').inspector({maxLength: false});

var sockets = {};

var processors = {
    'GameInfo': function (xml, game) {
        game.set('info', xml.GameInfo);
    },
    'OCSUpdate': function (xml, game) {
        processXmlNode(xml.OCSUpdate, game);
    },
    'subscribe_result': function (xml, game, callback) {
        var id = game.get('id');
        var ok = xml.subscribe_result.$.value == 'SUCCEED';
        if (ok) {
            console.log('lb <: Successfully subscribed to ' + id);
        } else {
            inspect(xml, 'lb <');
            console.log('Error during subscribing to ' + id);
        }
        callback && callback(ok);
    },
    'ack': function () {
    },
    'OddsUpdate': function (xml, game) {
        console.log('processing OddsUpdate');
        var info = game.get('info');
        xml.OddsUpdate.forEach(function (up) {
            var ocsId = up.$.outcome_set_id;
            var ocsIndex = false;
            if (!info.outcome_sets || !info.outcome_sets[0].outcome_set) {
                return;
            }
            info.outcome_sets[0].outcome_set.forEach(function (c, i) {
                if (c.$.id == ocsId) {
                    ocsIndex = i;
                }
            });
            if (ocsIndex === false) {
                console.log("Warning, ocs not found");
                return;
            }

            game.setDiff('info.outcome_sets.0.outcome_set.' + ocsIndex + '.outcomes.0', {
                outcome: up.OutcomeOddsUpdate,
                $: up.$
            });
        });
    }
}

function processXmlNode(node, game, callback) {
    for (var n in node) {
        if (node.hasOwnProperty(n)) {
            var p = processors[n];
            if (!p) {
                console.log('Unknown message type', n);
            } else {
                p(node, game, callback);
            }
        }
    }
}

function LivebetSubscribe(gameModel, callback) {
    var gameId = gameModel.get('id');

    if (sockets[gameId]) {
        console.log('already subscribed to gameId');
        return;
    }

    var socket = require('net').createConnection(port, host);
    sockets[gameId] = socket;

    carrier.carry(socket, function (data) {
        parseString(data, function (err, result) {
            processXmlNode(result, gameModel, callback);
        });
    }, "utf8", "\0");

    socket.on('connect', function () {
        console.log('lb >: subscribing to game ' + gameId);
        socket.write('<subscribe version="1" game_id="' + gameId + '" />\0');
    });
}

function LivebetUnsubscribe(gameModel, callback) {
    var gameId = gameModel.get('id');

    if (!sockets[gameId]) {
        console.log('not subscribed to gameId');
        return;
    }
    sockets[gameId].on('end', function () {
        console.log('LiveBet-XML socket closed');
        delete sockets[gameId];
        callback && callback();
    });
    sockets[gameId].end();
}

exports.subscribe = LivebetSubscribe;
exports.unsubscribe = LivebetUnsubscribe;
