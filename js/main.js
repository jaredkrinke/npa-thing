// This code interacts with HTML using jQuery and DataTables. It also calls into the main "process" function (in core.js).
//
// The code is run when the user clicks the "input-form" submit button.

$(function () {
    $('#input-form').submit(function (event) {
        // This is the main entry point to all of the code. This is run when the user clicks the "input-form" HTML form buttom
        event.preventDefault();

        // Get the file the user passed into the "file" file input HTML element
        var input = $('#file')[0];
        if (input.files && input.files[0]) {
            file = input.files[0];
            fr = new FileReader();
            fr.onload = function () {
                // Process the input file contents (and catch any errors)
                try {
                    // Call into the main logic function "process" (in core.js)
                    var input = fr.result;
                    var output = core.process(input, ',');
                    if (output.Data.length <= 0) {
                        throw "No input data";
                    }
    
                    // Hours are displayed with 2 decimal places
                    var renderHours = $('#output').DataTable.render.number( ',', '.', 2 );
    
                    // Round percents down to next 0.1% increment (to ensure that even 4.99% is inadequate, i.e. less than 5%)
                    var renderPercent = function (value) { return (Math.floor(value * 1000) / 10) + "%"; };
    
                    // Set up the tables
                    var summaryColumns = [
                        { title: 'Name' },
                        { title: 'Required Hours', render: renderHours },
                        { title: 'Total', render: renderHours },
                        { title: 'Supervised', render: renderHours },
                        { title: 'Supervised, Individual', render: renderHours },
                        { title: 'Fraction', render: renderPercent }
                    ];
    
                    var invalidColumns = [
                        { title: 'Name' },
                        { title: 'Individual' },
                        { title: 'Duration', renderHours }
                    ];
    
                    // Fill in all the tables
                    populateTable(
                        $('#output-names'),
                        [
                            { title: 'Name' },
                            { title: 'Aliases' }
                        ],
                        output.Names);
    
                    populateTable($('#output'), summaryColumns, output.Data);
                    populateTable($('#output-invalid'), invalidColumns, output.Invalid);
                    populateTable($('#output-raw'), summaryColumns, output.DataRaw);
                    populateTable($('#output-invalid-raw'), invalidColumns, output.InvalidRaw);
                } catch (e) {
                    // Notify the user of any errors that occur
                    alert("Error processing input file. Please double-check the instructions and make sure all the correct columns were exported to CSV format.\n\nInternal error message: " + e);
                }
            };

            fr.readAsText( file );
        }
    });
});

// Helper function to fill a table with data
function populateTable($, columns, data) {
    if (columns && data && data.length > 0) {
        // Align numbers to the right
        if (data.length > 1) {
            var firstRow = data[1];
            for (var i = 0, count = columns.length; i < count; i++) {
                var column = columns[i];
                if (typeof(firstRow[column.title]) === 'number') {
                    column.className = 'alignRight';
                }
            }
        }

        // Convert columns and data into the format required by the DataTable library
        var dataSet = [];
        for (var i = 0, count = data.length; i < count; i++) {
            var row = data[i];
            dataSet.push(columns.map(function (column) { return row[column.title]; }));
        }

        $.DataTable({
            destroy: true,
            data: dataSet,
            columns: columns
        });
    }
}

