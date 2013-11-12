var derby = require('derby');

var app = derby.createApp(module)
    .use(require('derby-ui-boot'))
    .use(require('../../ui'))


app.get('/', function (page, model, params, next) {
    model.subscribe('games.livebet', function (err) {
        if (err) return next(err);
        model.ref('_page.games', 'games.livebet');
        page.render('list');
    });
});

app.fn('placeticket', function (e, el) {
    var oc = e.get('.');
    alert('place ticket on outcome ' + oc.$.id);
});
