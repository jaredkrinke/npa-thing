(function (exports) {
    exports.process = function process(body, delimiter) {
        var data = parseSV(body, delimiter);
    
        var hours = data
            .where(function (row) { return row['Staff Job Title'] === 'Behavior Technician' || row['Staff Job Title'] === 'Behavior Specialist' || row['Staff Job Title'] === 'Program Manager'; })
            .where(function (row) { return !row['Appt. Status'].startsWith('Unavailable') && !row['Appt. Status'].startsWith('Vacation'); })
            .where(function (row) {
                var subjectLine = row['Subject Line'].toLowerCase();
                return !subjectLine.startsWith('drive')
                    && !subjectLine.startsWith('clean')
                    && (subjectLine.indexOf('prep time') < 0)
                    && !subjectLine.startsWith('cancel');
            })
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

        // Fix names
        var validNames = data
            .groupBy(['Staff Name'])
            .orderBy('key')
            .map(function (row) { return row.key; });
    
        var validNameMap = validNames
            .toDictionary(function (name) { return name; }, function () { return true; });

        var suspectNames = entriesRaw
            .where(function (row) { return !validNameMap[row.Name]; })
            .groupBy(['Name'])
            .orderBy('key')
            .map(function (row) {
                return row.key;
            });

        var fixedNames = fixSuspectNames(suspectNames, validNames);

        var names = fixedNames.Fixed
            .groupBy(['FixedName'])
            .map(function (group) {
                return {
                    Name: group.key,
                    Aliases: group.map(function (row) { return row.OriginalName; }).join('; ')
                };
            });

        var aliasToName = fixedNames.Fixed
            .toDictionary(function (row) { return row.OriginalName; }, function (row) { return row.FixedName; });
    
        var entriesInferred = entriesRaw
            .map(function (row) {
                var fixedName = aliasToName[row.Name];
                var inferred = !!fixedName;
                return {
                    Valid: row.Valid || inferred,
                    Inferred: inferred,
                    Name: fixedName || row.Name,
                    Individual: row.Individual,
                    Duration: row.Duration
                };
            });
    
        var entriesInvalid = entriesInferred
            .where(function (row) { return !row.Valid; })
            .map(function (row) {
                return {
                    Name: row.Name,
                    Individual: row.Individual,
                    Duration: row.Duration
                };
            });
    
        var entriesInvalidRaw = entriesRaw
            .where(function (row) { return !row.Valid; })
            .map(function (row) {
                return {
                    Name: row.Name,
                    Individual: row.Individual,
                    Duration: row.Duration
                };
            });

        var getPercents = function (input) {
            var entries = input
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
    
            return hours
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
                        'Required Hours': Math.max(0, (row.Duration * 0.05) - supervised),
                        Total: row.Duration,
                        Supervised: supervised,
                        'Supervised, Individual': supervisedIndividual,
                        Fraction: supervised / row.Duration
                    };
                });
            };

        return {
            Data: getPercents(entriesInferred),
            DataRaw: getPercents(entriesInferred.where(function (row) { return !row.Inferred; })),
            Invalid: entriesInvalid,
            InvalidRaw: entriesInvalidRaw,
            Names: names,

            // For testing
            ValidNames: validNames,
            SuspectNames: suspectNames
        };
    };

    var normalizeName = function (name) {
        var normalizedName = name
            .toLowerCase()
            .replace(/ *, */, ',')
            .replace(/ *- */, '-')
            .replace(/ +/, ' ')
            .replace(/[^-,a-zA-Z ]/, '');

        if (normalizedName.indexOf(',') < 0) {
            var parts = normalizedName.split(' ');
            if (parts.length === 2) {
                normalizedName = parts[1] + ',' + parts[0];
            }
        }

        return normalizedName;
    };

    function fixSuspectNames(suspectNames, validNames) {
        var tree = buildNameTree(validNames);

        var fixed = [];
        var notFixed = [];

        for (var i = 0, count = suspectNames.length; i < count; i++) {
            var name = suspectNames[i];

            // Only try to fix entries that aren't obviously invalid
            if (name.indexOf(';') === -1 && name.split(',').length <= 2) {
                var normalizedName = normalizeName(name);
                var matchingName = findMatchingName(normalizedName, tree);

                if (matchingName === undefined && normalizedName.indexOf('mc') === 0) {
                    matchingName = findMatchingName('mac' + normalizedName.substr(2), tree);
                }

                if (matchingName === undefined && normalizedName.indexOf('mac') === 0) {
                    matchingName = findMatchingName('mc' + normalizedName.substr(3), tree);
                }

                // If no match, try reversing the order of first/last name
                if (matchingName === undefined) {
                    var parts = normalizedName.split(',');
                    var reversedName = parts.reverse().join(',');
                    matchingName = findMatchingName(reversedName, tree);
                }

                if (matchingName) {
                    fixed.push({
                        OriginalName: name,
                        FixedName: matchingName
                    });

                    continue;
                }
            }

            notFixed.push(name);
        }

        return {
            Fixed: fixed,
            NotFixed: notFixed
        };
    }

    var buildNameTree = function (names) {
        var tree = {};
        for (var i = 0, count = names.length; i < count; i++) {
            var name = names[i];
            addToNameTree(tree, normalizeName(name), name);
        }

        return tree;
    };

    var addToNameTree = function (tree, name, value) {
        for (var i = 0, count = name.length; i < count; i++) {
            var c = name[i];
            var subtree = tree[c];
            if (subtree === undefined) {
                subtree = {
                    items: []
                };

                tree[c] = subtree;
            }

            subtree.items.push(value);
            tree = subtree;
        }
    };

    var findMatchingName = function (name, tree) {
        for (var i = 0, count = name.length; i < count; i++) {
            var c = name[i];
            tree = tree[c];
            if (tree === undefined) {
                break;
            }
            else if (tree.items.length === 1) {
                // Make sure initials match
                var matchingName = tree.items[0];
                var originalParts = name.split(',');
                var fixedParts = normalizeName(matchingName).split(',');
                if (originalParts.length >= 2 && fixedParts.length >= 2 && originalParts[0][0] === fixedParts[0][0] && originalParts[1][0] === fixedParts[1][0]) {
                    return matchingName;
                }

                break;
            }
        }

        return
    };
    
    var parseResultNote = function (note) {
        return note.split(/ *; */);
    };
    
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
    };
    
    String.prototype.forEachLine = function (cb) {
        var lines = this.split(/\r?\n/);
        for (var i = 0, count = lines.length; i < count; i++) {
            cb(lines[i]);
        }
    };
    
    var parseSVLine = function (line, delimiter) {
        var index = 0;
        var notInQuotes = true; // Inverted to work around Edge JIT bug ChakraCore #6252
        var inEscape = false;
        var quoted = false;
        var values = [];
        for (var i = 0, count = line.length; i < count; i++) {
            if (!notInQuotes) {
                if (inEscape) {
                    inEscape = false;
                } else {
                    if (line[i] === '\\') {
                        inEscape = true;
                    } else if (line[i] === '"') {
                        notInQuotes = true;
                    }
                }
            } else {
                if (line[i] === '"') {
                    notInQuotes = false;
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
    };
    
    var parseSV = function (input, delimiter) {
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
    };
    
    var escapeCsvEntry = function (entry) {
        var e = '' + entry;
        if (e.indexOf(',') >= 0) {
            return '"' + e.replace(/"/, '\\') + '"';
        }
        return e;
    };
    
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
    };

    // For testing
    exports.fixSuspectNames = fixSuspectNames;

})(typeof (exports) === 'undefined' ? (core = {}) : exports);
