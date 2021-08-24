// This file includes the core parsing/computation logic in the following order:
//
// * Main logic entry point named "process" (this calls into many helpers defined later)
// * Helpers for fixing mistyped names
// * Helpers for dealing with rows of data (modeled after LINQ)
// * Helpers for parsing comma-separated value (CSV) input strings/files

(function (exports) {

    // This is the main logic entry point
    exports.process = function process(body, delimiter) {
        // Parse input string into an array of dictionary-like objects
        var data = parseSV(body, delimiter);
    
        // Filter input rows, group by staff name, and sum the number of hours worked
        var hours = data
            .where(function (row) { return row['Staff Job Title'] === 'Behavior Technician' || row['Staff Job Title'] === 'BCaBA' || row['Staff Job Title'] === 'Program Manager'; })
            .where(function (row) { return !row['Appt. Status'].startsWith('Unavailable') && !row['Appt. Status'].startsWith('Vacation'); })
            .where(function (row) {
                // Filter based on "Subject Line" column
                var subjectLine = row['Subject Line'].toLowerCase();
                return !subjectLine.startsWith('drive')
                    && !subjectLine.startsWith('clean')
                    && !subjectLine.startsWith('pto')
                    && !subjectLine.startsWith('epto')
                    && !subjectLine.startsWith('fmla')
                    && !subjectLine.startsWith('efmla')
                    && !subjectLine.startsWith('comp')
                    && !subjectLine.startsWith('inservice')
                    && !subjectLine.startsWith('in-service')
                    && (subjectLine.indexOf('prep time') < 0)
                    && !subjectLine.startsWith('cancel');
            })
            .where(function (row) {
                // Filter based on "Office Note" column
                var officeNoteCased = row['Office Note'];
                var include = true;
                if (officeNoteCased) {
                    var officeNote = officeNoteCased.toLowerCase();
                    include = (officeNote.indexOf('inservice') < 0)
                        && (officeNote.indexOf('in-service') < 0)
                        && (officeNote.indexOf('in service') < 0)
                        && (officeNote.indexOf('indirect') < 0)
                        && !(/pd\s|pd$/.test(officeNote))
                        && !(/client no[ \-]show/.test(officeNote));
                }
                return include;
            })
            .groupBy(['Staff Name'])
            .orderBy('key')
            .map(function (group) {
                return {
                    Name: group.key,
                    Duration: group.reduce(function (acc, item) { return acc + parseFloat(item['Duration (Hrs)']); }, 0)
                };
            });
    
        // Create a map from staff name to hours worked
        var hoursMap = hours.toDictionary(function (item) { return item.Name; }, function (item) { return item.Duration; });
    
        // Create rows for each name, to handle group supervision
        var entriesRaw = data
            .where(function (row) { return row['Result Note'] && parseFloat(row['Duration (Hrs)']); })
            .selectMany(function (row) {
                var names = [];
    
                // Heuristics for ignoring unwanted/invalid rows
                var resultNote = row['Result Note'];
                if (resultNote) {
                    // Only parse "Result Note" column on rows with certain job titles
                    if (row['Staff Job Title'] === 'BCaBA' || row['Staff Job Title'] === 'BCBA') {
                        // There should be at most 10 people, semicolon-delimited, with at most 3 spaces per name
                        var resultNoteNames = parseResultNote(resultNote);
                        var nameCount = resultNoteNames.length;
                        var spaceCount = resultNote.split(/ +/).length;
                        var reasonableNumberOfSpaces = (spaceCount < (nameCount * 3));

                        if (reasonableNumberOfSpaces) {
                            for (var i = 0, count = resultNoteNames.length; i < count; i++) {
                                var name = resultNoteNames[i];
                                if (name != serviceLogEntry) {
                                    names.push(name);
                                }
                            }
                        }
                    }
                }
    
                // Duplicate row for each supervisee
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

        // Map from aliases to correct names
        var aliasToName = fixedNames.Fixed
            .toDictionary(function (row) { return row.OriginalName; }, function (row) { return row.FixedName; });
    
        // Use correct names, when available (and mark others as invalid)
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

        // Record invalid entries for later return
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

        // Helper to calculate supervision percents on valid rows (used below)
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
    
            // Note: "hours" (defined way at the beginning) is grouped by staff name, so there will be 1 row for each staff name that wasn't filtered
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

        // Return data for all required tables
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

    // Helpers for fixing names
    var normalizeName = function (name) {
        var normalizedName = name
            .toLowerCase()
            .replace(/ *, */, ',')  // Remove extra spaces
            .replace(/ *- */, '-')  // Remove extra spaces
            .replace(/ +/, ' ')     // Coalesce spaces
            .replace(/[^-,a-zA-Z ]/, ''); // Remove characters we don't care about (TODO: this probably should leave any alphabetical characters alone, e.g. characters with accents)

        // Ensure name is last name, first name
        if (normalizedName.indexOf(',') < 0) {
            var parts = normalizedName.split(' ');
            if (parts.length === 2) {
                normalizedName = parts[1] + ',' + parts[0];
            }
        }

        return normalizedName;
    };

    function fixSuspectNames(suspectNames, validNames) {
        // Use a bunch of random heuristics to try and fix up mistyped/misspelled names

        // Create a tree for looking up names based on the first several characters
        var tree = buildNameTree(validNames);

        var fixed = [];
        var notFixed = [];

        for (var i = 0, count = suspectNames.length; i < count; i++) {
            var name = suspectNames[i];

            // Only try to fix entries that aren't obviously invalid
            if (name.indexOf(';') === -1 && name.split(',').length <= 2) {
                var normalizedName = normalizeName(name);
                var matchingName = findMatchingName(normalizedName, tree);

                // Special cases to handle "McSomething" and "MacSomething"
                if (matchingName === undefined && normalizedName.indexOf('mc') === 0) {
                    matchingName = findMatchingName('mac' + normalizedName.substr(2), tree);
                }

                if (matchingName === undefined && normalizedName.indexOf('mac') === 0) {
                    matchingName = findMatchingName('mc' + normalizedName.substr(3), tree);
                }

                // If no match, try reversing the order of first/last name
                // (Note: sometimes this can incorrectly match names, especially if someone has left the company and isn't in the staff list)
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
        // Find a matching name in a name tree
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
                    // Make sure 85% of original letters exist in the adjusted name
                    var originalPartsConcatenated = originalParts.join("");
                    var fixedPartsConcatenated = fixedParts.join("");
                    var totalCharacters = 0;
                    var matchedCharacters = 0;
                    for (var j = 0; j < originalPartsConcatenated.length; j++) {
                        totalCharacters++;
                        if (fixedPartsConcatenated.indexOf(originalPartsConcatenated.charAt(j)) >= 0) {
                            matchedCharacters++;
                        }
                    }

                    if ((matchedCharacters / totalCharacters) >= 0.85) {
                        return matchingName;
                    }
                }

                break;
            }
        }

        return;
    };
    
    // Helper for splitting lists of names
    var parseResultNote = function (note) {
        return note.split(/ *; */);
    };
    
    // Helpers for dealing with rows of data (modeled after LINQ)

    // Concatenate a second array onto the end of this one (note: this create a new array for the result)
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
    
    // Split/explode array (one-to-many mapping), e.g. split ['a,b,c', 'd'] into ['a', 'b', 'c', 'd']
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
    
    // Convert an array into a dictionary using the supplied callback functions to get the corresponding key and the value for each item
    Array.prototype.toDictionary = function (getKey, getValue) {
        var result = {};
        for (var i = 0, count = this.length; i < count; i++) {
            var item = this[i];
            result[getKey(item)] = getValue(item);
        }
        return result;
    };
    
    // Sort an array based on the named property (note: this mutates the array; TODO: create a new array instead, to avoid subtle bugs)
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
    
    // Create a new array with only items that match the "test" callback function (which should return true to include an item)
    Array.prototype.where = function (test) {
        var matched = [];
        for (var i = 0, count = this.length; i < count; i++) {
            if (test(this[i])) {
                matched.push(this[i]);
            }
        }
        return matched;
    };
    
    // Group an array based on one or more properties; there will be an object for each group with a property named "key" that corresponds to the group's key
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
    
    // Helper for running a callback function on each line of a string
    String.prototype.forEachLine = function (cb) {
        var lines = this.split(/\r?\n/);
        for (var i = 0, count = lines.length; i < count; i++) {
            cb(lines[i]);
        }
    };
    
    // Helper for parsing delimiter-separated value lines
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
    
    // Helper for parsing an entire delimiter-separated value file
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

    // These functions are exported for testing purposes only
    exports.fixSuspectNames = fixSuspectNames;
    exports.parseSV = parseSV;

})(typeof (exports) === 'undefined' ? (core = {}) : exports);
