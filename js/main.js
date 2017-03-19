﻿$(function () {
    $('#input-form').submit(function (event) {
        event.preventDefault();

        var input = $('#file')[0];
        if (input.files && input.files[0]) {
            file = input.files[0];
            fr = new FileReader();
            fr.onload = function () {
                var input = fr.result;
                var output = process(input, ',');

                populateTable($('#output'), output.Data);
                populateTable($('#output-invalid'), output.Invalid);
            };

            fr.readAsText( file );
        }
    });
});

function populateTable($, data) {
    if (data && data.length > 0) {
        var schema = [];
        for (var key in data[0]) {
            schema.push(key);
        }

        var columns = schema.map(function (key) { return { title: key }; });

        var dataSet = [];
        for (var i = 0, count = data.length; i < count; i++) {
            var row = data[i];
            dataSet.push(schema.map(function (key) { return row[key]; }));
        }

        $.DataTable({
            data: dataSet,
            columns: columns
        });
    }
}

function process(body, delimiter) {
    var data = parseSV(body, delimiter);

    var hours = data
        .where(function (row) { return row['Staff Job Title'] === 'Behavior Technician' || row['Staff Job Title'] === 'Behavior Specialist'; })
        .groupBy(['Staff Name'])
        .orderBy('key')
        .map(function (group) {
            return {
                Name: group.key,
                Duration: group.reduce(function (acc, item) { return acc + parseFloat(item['Duration (Hrs)']); }, 0)
            };
        });

    var hoursMap = hours.toDictionary(function (item) { return item.Name; }, function (item) { return item.Duration; });

    var entriesRaw = data
        .where(function (row) { return (row['Service Log Entry'] || row['Result Note']) && parseFloat(row['Duration (Hrs)']); })
        .selectMany(function (row) {
            var names = [];
            var serviceLogEntry = row['Service Log Entry'];
            if (serviceLogEntry) {
                names.push(serviceLogEntry);
            }

            var resultNote = row['Result Note'];
            if (resultNote) {
                var resultNoteNames = parseResultNote(resultNote);
                for (var i = 0, count = resultNoteNames.length; i < count; i++) {
                    var name = resultNoteNames[i];
                    if (name != serviceLogEntry) {
                        names.push(name);
                    }
                }
            }

            return names.map(function (name) {
                return {
                    Valid: !!(hoursMap[name]),
                    Name: name,
                    Individual: (names.length === 1),
                    Duration: parseFloat(row['Duration (Hrs)'])
                };
            });
        });

    var entriesInvalid = entriesRaw
        .where(function (row) { return !row.Valid; })
        .map(function (row) {
            return {
                Name: row.Name,
                Individual: row.Individual,
                Duration: row.Duration
            };
        });

    var entries = entriesRaw
        .where(function (row) { return row.Valid; })
        .groupBy(['Name'])
        .orderBy('key')
        .map(function (group) {
            return {
                Name: group.key,
                DurationIndividual: group.reduce(function (acc, row) { return acc + (row.Individual ? row.Duration : 0); }, 0),
                Duration: group.reduce(function (acc, row) { return acc + row.Duration; }, 0)
            };
        })
        .toDictionary(function (row) { return row.Name; }, function (row) { return row; });

    var percents = hours
        .map(function (row) {
            var supervised = 0;
            var supervisedIndividual = 0;
            var data = entries[row.Name];
            if (data !== undefined) {
                supervised = data.Duration;
                supervisedIndividual = data.DurationIndividual;
            }

            return {
                Name: row.Name,
                RequiredHours: Math.max(0, (row.Duration * 0.07) - supervised),
                Total: row.Duration,
                Supervised: supervised,
                'Supervised (Individual)': supervisedIndividual,
                Fraction: supervised / row.Duration
            };
        });

    return {
        Data: percents,
        Invalid: entriesInvalid,
    };
}

function parseResultNote(note) {
    return note.split(/ *; */);
}

Array.prototype.concat = function (other) {
    var result = [];
    for (var i = 0, count = this.length; i < count; i++) {
        result.push(this[i]);
    }
    for (i = 0, count = other.length; i < count; i++) {
        result.push(other[i]);
    }
    return result;
};

Array.prototype.selectMany = function (f) {
    var result = [];
    for (var i = 0, count = this.length; i < count; i++) {
        var subresult = f(this[i]);
        for (var j = 0, count2 = subresult.length; j < count2; j++) {
            result.push(subresult[j]);
        }
    }
    return result;
};

Array.prototype.toDictionary = function (getKey, getValue) {
    var result = {};
    for (var i = 0, count = this.length; i < count; i++) {
        var item = this[i];
        result[getKey(item)] = getValue(item);
    }
    return result;
};

Array.prototype.orderBy = function (property) {
    return this.sort(function (a, b) {
        var pa = a[property];
        var pb = b[property];
        if (pa < pb) {
            return -1;
        }
        if (pa > pb) {
            return 1;
        }
        return 0;
    });
};

Array.prototype.where = function (test) {
    var matched = [];
    for (var i = 0, count = this.length; i < count; i++) {
        if (test(this[i])) {
            matched.push(this[i]);
        }
    }
    return matched;
};

Array.prototype.groupBy = function (properties) {
    var indexes = {};
    var groups = [];
    for (var i = 0, count = this.length; i < count; i++) {
        var keyValues = [];
        for (var j = 0, count2 = properties.length; j < count2; j++) {
            keyValues.push(this[i][properties[j]]);
        }
        var key = keyValues.join('$');
        if (indexes[key] === undefined) {
            indexes[key] = groups.length;
            var group = [];
            group.key = key;
            groups.push(group);
        }

        groups[indexes[key]].push(this[i]);
    }

    return groups;
}

function readStream(stream, cb) {
    var s = '';
    stream.on('readable', function (buffer) {
        s += buffer.read().toString();
    });

    stream.on('end', function () {
        if (cb) {
            cb(s);
        }
    });
}

String.prototype.forEachLine = function (cb) {
    var lines = this.split(/\r?\n/);
    for (var i = 0, count = lines.length; i < count; i++) {
        cb(lines[i]);
    }
};

function parseSVLine(line, delimiter) {
    var index = 0;
    var inQuotes = false;
    var inEscape = false;
    var quoted = false;
    var values = [];
    for (var i = 0, count = line.length; i < count; i++) {
        if (inQuotes) {
            if (inEscape) {
                inEscape = false;
            } else {
                if (line[i] === '\\') {
                    inEscape = true;
                } else if (line[i] === '"') {
                    inQuotes = false;
                }
            }
        } else {
            if (line[i] === '"') {
                inQuotes = true;
                inEscape = false;
                quoted = true;
            } else if (line[i] === delimiter) {
                values.push(line.substring(index + (quoted ? 1 : 0), i - (quoted ? 1 : 0)).trim());
                index = i + 1;
                quoted = false;
            }
        }
    }

    values.push(line.substr(index));

    return values;
}

function parseSV(input, delimiter) {
    var first = true;
    var schema = [];
    var rows = [];
    input.forEachLine(function (line) {
        if (first) {
            first = false;
            schema = parseSVLine(line, delimiter);
        } else {
            var values = parseSVLine(line, delimiter);
            var row = {};
            for (var i = 0, count = values.length; i < count; i++) {
                row[schema[i]] = values[i];
            }

            rows.push(row);
        }
    });

    return rows;
}

function escapeCsvEntry(entry) {
    var e = '' + entry;
    if (e.indexOf(',') >= 0) {
        return '"' + e.replace(/"/, '\\') + '"';
    }
    return e;
}

Array.prototype.toCsv = function () {
    var schema = [];
    for (var key in this[0]) {
        schema.push(key);
    }

    var output = schema.map(function (name) { return escapeCsvEntry(name); }).join(',') + '\n';
    for (var i = 0, count = this.length; i < count; i++) {
        var row = this[i];
        output += schema.map(function (name) { return escapeCsvEntry(row[name]); }).join(',') + '\n';
    }

    return output;
}

