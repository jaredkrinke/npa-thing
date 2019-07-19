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

                var renderHours = $('#output').DataTable.render.number( ',', '.', 2 );

                // Round percents down to next 0.1% increment (to ensure that even 4.99% is inadequate, i.e. less than 5%)
                var renderPercent = function (value) { return (Math.floor(value * 1000) / 10) + "%"; };

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
            };

            fr.readAsText( file );
        }
    });
});

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

        var dataSet = [];
        for (var i = 0, count = data.length; i < count; i++) {
            var row = data[i];
            dataSet.push(columns.map(function (column) { return row[column.title]; }));
        }

        $.DataTable({
            data: dataSet,
            columns: columns
        });
    }
}

