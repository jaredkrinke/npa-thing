var fs = require('fs');
var core = require('./core.js');

if (process.argv.length === 3) {
    var fileName = process.argv[2];
    fs.readFile(fileName, { encoding: 'utf8' }, function (err, body) {
        var result = core.process(body, ',');
        console.log(result.Data);
        console.log(result.Names);
    });
}

