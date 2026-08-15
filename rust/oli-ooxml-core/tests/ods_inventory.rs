use std::io::{Cursor, Write};

use oli_ooxml_core::{CellType, CellValue, InventoryError, InventoryLimits, inventory_ods};
use zip::{ZipWriter, write::SimpleFileOptions};

fn package(parts: &[(&str, &str)]) -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    for (name, content) in parts {
        writer
            .start_file(name, SimpleFileOptions::default())
            .unwrap();
        writer.write_all(content.as_bytes()).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

fn ods_package(content_body: &str) -> Vec<u8> {
    let content = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<office:document-content
 xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
 xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
 xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">
 <office:body>
  <office:spreadsheet>
{content_body}
  </office:spreadsheet>
 </office:body>
</office:document-content>"#
    );
    package(&[
        ("mimetype", "application/vnd.oasis.opendocument.spreadsheet"),
        ("content.xml", &content),
    ])
}

#[test]
fn inventories_sheets_types_and_dimensions() {
    let bytes = ods_package(
        r#"<table:table table:name="Dados">
 <table:table-column table:number-columns-repeated="2"/>
 <table:table-row>
  <table:table-cell office:value-type="string"><text:p>Nome</text:p></table:table-cell>
  <table:table-cell office:value-type="float" office:value="42.5"><text:p>42.5</text:p></table:table-cell>
 </table:table-row>
 <table:table-row>
  <table:table-cell office:value-type="boolean" office:boolean-value="true"><text:p>true</text:p></table:table-cell>
  <table:table-cell office:value-type="date" office:date-value="2026-08-14"><text:p>2026-08-14</text:p></table:table-cell>
 </table:table-row>
</table:table>
<table:table table:name="Vazia"/>"#,
    );
    let inventory = inventory_ods(&bytes).unwrap();

    assert_eq!(inventory.format, "ods");
    assert_eq!(inventory.sheets.len(), 2);
    assert_eq!(inventory.sheets[0].name, "Dados");
    assert_eq!(inventory.sheets[1].name, "Vazia");
    assert!(inventory.sheets[1].cells.is_empty());

    let cells = &inventory.sheets[0].cells;
    assert_eq!(cells.len(), 4);
    assert_eq!(cells[0].address, "A1");
    assert_eq!(cells[0].cell_type, CellType::String);
    assert_eq!(
        cells[0].raw_value,
        Some(CellValue::String("Nome".to_owned()))
    );
    assert_eq!(cells[1].address, "B1");
    assert_eq!(cells[1].cell_type, CellType::Number);
    assert_eq!(cells[1].raw_value, Some(CellValue::Number(42.5)));
    assert_eq!(cells[2].address, "A2");
    assert_eq!(cells[2].cell_type, CellType::Boolean);
    assert_eq!(cells[2].raw_value, Some(CellValue::Boolean(true)));
    assert_eq!(cells[3].address, "B2");
    assert_eq!(cells[3].cell_type, CellType::Date);
    assert_eq!(cells[3].date_value.as_deref(), Some("2026-08-14T00:00:00"));

    let actual = inventory.sheets[0].actual_dimension.as_ref().unwrap();
    assert_eq!((actual.start.as_str(), actual.end.as_str()), ("A1", "B2"));
    assert_eq!(actual.cell_count, 4);
}

#[test]
fn preserves_formulas_merges_and_hidden_structures() {
    let bytes = ods_package(
        r#"<table:table table:name="Plano">
 <table:table-column/>
 <table:table-column table:visibility="collapse"/>
 <table:table-row>
  <table:table-cell office:value-type="float" office:value="10"><text:p>10</text:p></table:table-cell>
  <table:table-cell office:value-type="float" office:value="20"><text:p>20</text:p></table:table-cell>
 </table:table-row>
 <table:table-row table:visibility="collapse">
  <table:table-cell office:value-type="float" office:value="30"
   table:formula="of:=SUM([.A1:.A2])"><text:p>30</text:p></table:table-cell>
  <table:table-cell table:number-columns-spanned="2" table:number-rows-spanned="1"
   office:value-type="string"><text:p>Total</text:p></table:table-cell>
  <table:covered-table-cell/>
 </table:table-row>
</table:table>"#,
    );
    let inventory = inventory_ods(&bytes).unwrap();
    let sheet = &inventory.sheets[0];

    assert_eq!(sheet.hidden_columns[0].start, 2);
    assert_eq!(sheet.hidden_columns[0].end, 2);
    assert_eq!(sheet.hidden_rows, [2]);

    let formula_cell = sheet
        .cells
        .iter()
        .find(|cell| cell.address == "A2")
        .unwrap();
    assert_eq!(formula_cell.formula.as_deref(), Some("=SUM([.A1:.A2])"));

    assert_eq!(sheet.merged_ranges, ["B2:C2"]);
}

#[test]
fn truncates_repeated_cells_and_rows_with_a_diagnostic() {
    let bytes = ods_package(
        r#"<table:table table:name="Filler">
 <table:table-row>
  <table:table-cell office:value-type="string" table:number-columns-repeated="5000">
   <text:p>Repetido</text:p>
  </table:table-cell>
 </table:table-row>
 <table:table-row table:number-rows-repeated="10000">
  <table:table-cell office:value-type="float" office:value="1"><text:p>1</text:p></table:table-cell>
 </table:table-row>
 <table:table-row table:number-rows-repeated="1000000"/>
</table:table>"#,
    );
    let inventory = inventory_ods(&bytes).unwrap();
    let sheet = &inventory.sheets[0];

    // Apenas a primeira ocorrência de cada célula/linha repetida é materializada.
    assert_eq!(sheet.cells.len(), 2);
    assert_eq!(sheet.cells[0].address, "A1");
    assert_eq!(sheet.cells[1].address, "A2");
    assert!(
        inventory
            .diagnostics
            .iter()
            .any(|item| item.code == "ods-repeated-cell-truncated")
    );
    assert!(
        inventory
            .diagnostics
            .iter()
            .any(|item| item.code == "ods-repeated-row-truncated")
    );
}

#[test]
fn rejects_missing_content_part() {
    let bytes = package(&[("mimetype", "application/vnd.oasis.opendocument.spreadsheet")]);
    let error = inventory_ods(&bytes).unwrap_err();
    assert!(matches!(error, InventoryError::ResourceLimit(_)));
}

#[test]
fn enforces_sheet_limit() {
    let mut body = String::new();
    for index in 0..5 {
        body.push_str(&format!(r#"<table:table table:name="S{index}"/>"#));
    }
    let bytes = ods_package(&body);
    let limits = InventoryLimits {
        max_sheets: 3,
        ..InventoryLimits::default()
    };
    let error =
        oli_ooxml_core::inventory_ods_with_limits(&bytes, limits).expect_err("deve exceder");
    assert!(matches!(error, InventoryError::ResourceLimit(_)));
}
