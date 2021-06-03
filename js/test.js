// This file is used for testing outside the browser in the Node.js runtime. The code is usually modified to test different things out.

var fs = require('fs');
var core = require('./core.js');

if (process.argv.length === 3) {
    var fileName = process.argv[2];
    fs.readFile(fileName, { encoding: 'utf8' }, function (err, body) {
        // Run the main "process" function and just log the results directly to the console
        var result = core.process(body, ',');
        console.log(result.Data);
        console.log(result.Names);
    });
}

