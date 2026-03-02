const XLSX = require('xlsx');
const fs = require('fs');

const buffer = fs.readFileSync('docs/exportacao_manga_2025.xlsx');
const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
console.log("Sheet names:", wb.SheetNames);
if (wb.SheetNames.length > 1) {
    const wsName = wb.SheetNames[1];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wsName], { raw: false, dateNF: 'YYYY-MM-DD' });
    console.log("Sheet 2 rows:", rows.length);
    if (rows.length > 0) console.log(rows[0]);
}
