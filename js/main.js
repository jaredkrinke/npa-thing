$(function () {
    $('#input-form').submit(function (event) {
        event.preventDefault();

        var input = $('#file')[0];
        if (input.files && input.files[0]) {
            file = input.files[0];
            fr = new FileReader();
            fr.onload = function () {
                var input = fr.result;
                var output = core.process(input, ',');

                populateTable($('#output'), output.Data);
                populateTable($('#output-names'), output.Names);
                populateTable($('#output-raw'), output.DataRaw);
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

        var columns = schema.map(function (key) {
            return {
                title: key,
                render: $.DataTable.render.number( ',', '.', 2 )
            };
        });

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

