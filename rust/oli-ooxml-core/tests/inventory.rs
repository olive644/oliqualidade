use std::io::{Cursor, Write};

use oli_ooxml_core::{
    CellType, CellValue, DateSystem, InventoryError, InventoryLimits, SheetState, inventory_ooxml,
    inventory_ooxml_with_limits,
};
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

fn workbook_package(extra_parts: &[(&str, &str)]) -> Vec<u8> {
    let workbook = r#"<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
 <workbookPr date1904="1"/>
 <sheets>
  <sheet name="Visível" sheetId="1" r:id="rId1"/>
  <sheet name="Oculta" sheetId="2" state="hidden" r:id="rId2"/>
  <sheet name="Muito oculta" sheetId="3" state="veryHidden" r:id="rId3"/>
 </sheets>
</workbook>"#;
    let relationships = r#"<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
 <Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/>
 <Relationship Id="rId2" Type="worksheet" Target="worksheets/sheet2.xml"/>
 <Relationship Id="rId3" Type="worksheet" Target="worksheets/sheet3.xml"/>
</Relationships>"#;
    let mut parts = vec![
        ("xl/workbook.xml", workbook),
        ("xl/_rels/workbook.xml.rels", relationships),
    ];
    parts.extend_from_slice(extra_parts);
    package(&parts)
}

#[test]
fn inventories_date_system_visibility_and_real_dimensions() {
    let sheet1 = r#"<worksheet><dimension ref="A1:Z99"/><cols>
<col min="3" max="5" hidden="1"/>
</cols><sheetData>
<row r="2" hidden="true"><c r="B2"><v>1</v></c><c r="D2"><v>2</v></c></row>
<row r="5"><c r="C5"><v>3</v></c></row></sheetData></worksheet>"#;
    let empty = r#"<worksheet><dimension ref="A1"/><sheetData/></worksheet>"#;
    let bytes = workbook_package(&[
        ("xl/worksheets/sheet1.xml", sheet1),
        ("xl/worksheets/sheet2.xml", empty),
        ("xl/worksheets/sheet3.xml", empty),
    ]);
    let inventory = inventory_ooxml(&bytes).unwrap();

    assert_eq!(inventory.date_system, DateSystem::Excel1904);
    assert_eq!(inventory.sheets.len(), 3);
    assert_eq!(inventory.sheets[0].state, SheetState::Visible);
    assert_eq!(inventory.sheets[1].state, SheetState::Hidden);
    assert_eq!(inventory.sheets[2].state, SheetState::VeryHidden);
    assert_eq!(
        inventory.sheets[0].declared_dimension.as_deref(),
        Some("A1:Z99")
    );
    let actual = inventory.sheets[0].actual_dimension.as_ref().unwrap();
    assert_eq!((actual.start.as_str(), actual.end.as_str()), ("B2", "D5"));
    assert_eq!((actual.rows, actual.columns, actual.cell_count), (4, 3, 3));
    assert_eq!(inventory.sheets[0].hidden_rows, [2]);
    assert_eq!(inventory.sheets[0].hidden_columns[0].start, 3);
    assert_eq!(inventory.sheets[0].hidden_columns[0].end, 5);
    assert!(
        inventory
            .diagnostics
            .iter()
            .any(|item| item.code == "dimension-mismatch")
    );
}

#[test]
fn normalizes_and_formats_serial_dates_and_preserves_merges() {
    let styles = r#"<styleSheet>
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>
<cellXfs count="5"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="22"/><xf numFmtId="46"/><xf numFmtId="164"/></cellXfs>
</styleSheet>"#;
    let sheet = r#"<worksheet><dimension ref="A1:D2"/><sheetData><row r="1">
<c r="A1" s="1"><v>0</v></c>
<c r="B1" s="2"><v>1.5</v></c>
<c r="C1" s="3"><v>1.5</v></c>
<c r="D1" s="4"><v>44555</v></c>
</row></sheetData><mergeCells count="2"><mergeCell ref="A1:B1"/><mergeCell ref="C1:D2"/></mergeCells></worksheet>"#;
    let bytes = workbook_package(&[
        ("xl/styles.xml", styles),
        ("xl/worksheets/sheet1.xml", sheet),
    ]);
    let inventory = inventory_ooxml(&bytes).unwrap();
    let sheet = &inventory.sheets[0];

    assert_eq!(sheet.merged_ranges, ["A1:B1", "C1:D2"]);
    assert_eq!(sheet.cells[0].cell_type, CellType::Date);
    assert_eq!(
        sheet.cells[0].date_value.as_deref(),
        Some("1904-01-01T00:00:00")
    );
    assert_eq!(sheet.cells[0].display_value, "1/1/04");
    assert_eq!(sheet.cells[1].display_value, "1/2/04 12:00");
    assert_eq!(sheet.cells[2].display_value, "36:00:00");
    assert_eq!(sheet.cells[3].display_value, "2025-12-26");
}

#[test]
fn reads_shared_inline_typed_formula_and_formatted_cells() {
    let shared_strings = r#"<sst>
<si><t>Hello &amp; </t><r><t>world</t></r></si>
</sst>"#;
    let styles = r#"<styleSheet>
<numFmts count="1"><numFmt numFmtId="164" formatCode="R$ #,##0.00"/></numFmts>
<cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="10"/><xf numFmtId="164"/></cellXfs>
</styleSheet>"#;
    let sheet = r#"<worksheet><dimension ref="A1:G1"/><sheetData><row r="1">
<c r="A1" t="s"><v>0</v></c>
<c r="B1" t="b"><v>1</v></c>
<c r="C1" s="1"><v>0.125</v></c>
<c r="D1" t="inlineStr"><is><r><t>rich </t></r><r><t>text</t></r></is></c>
<c r="E1" s="2"><f>SUM(C1, 12)</f><v>12.5</v></c>
<c r="F1" t="e"><v>#DIV/0!</v></c>
<c r="G1" t="d"><v>2026-08-13T00:00:00Z</v></c>
</row></sheetData></worksheet>"#;
    let bytes = workbook_package(&[
        ("xl/sharedStrings.xml", shared_strings),
        ("xl/styles.xml", styles),
        ("xl/worksheets/sheet1.xml", sheet),
    ]);
    let inventory = inventory_ooxml(&bytes).unwrap();
    let cells = &inventory.sheets[0].cells;

    assert_eq!(cells.len(), 7);
    assert_eq!(
        cells[0].raw_value,
        Some(CellValue::String("Hello & world".into()))
    );
    assert_eq!(cells[1].raw_value, Some(CellValue::Boolean(true)));
    assert_eq!(cells[2].display_value, "12.50%");
    assert_eq!(
        cells[3].raw_value,
        Some(CellValue::String("rich text".into()))
    );
    assert_eq!(cells[4].formula.as_deref(), Some("=SUM(C1, 12)"));
    assert_eq!(cells[4].raw_value, Some(CellValue::Number(12.5)));
    assert_eq!(cells[4].number_format.as_deref(), Some("R$ #,##0.00"));
    assert_eq!(cells[5].cell_type, CellType::Error);
    assert_eq!(cells[6].cell_type, CellType::Date);
}

#[test]
fn rejects_unsafe_archive_paths() {
    for name in ["../evil.xml", "xl/../evil.xml"] {
        let bytes = package(&[(name, "nope")]);
        assert!(matches!(
            inventory_ooxml(&bytes),
            Err(InventoryError::UnsafePath(_))
        ));
    }
}

#[test]
fn enforces_configurable_resource_limits_without_large_fixture() {
    let bytes = workbook_package(&[]);
    let limits = InventoryLimits {
        max_total_uncompressed_bytes: 32,
        ..InventoryLimits::default()
    };
    assert!(matches!(
        inventory_ooxml_with_limits(&bytes, limits),
        Err(InventoryError::ResourceLimit(_))
    ));

    let limits = InventoryLimits {
        max_sheets: 2,
        ..InventoryLimits::default()
    };
    assert!(matches!(
        inventory_ooxml_with_limits(&bytes, limits),
        Err(InventoryError::ResourceLimit(_))
    ));

    let sheet = r#"<worksheet><sheetData><row r="1">
<c r="A1"><v>1</v></c><c r="B1"><v>2</v></c><c r="C1"><v>3</v></c>
</row></sheetData></worksheet>"#;
    let bytes = workbook_package(&[("xl/worksheets/sheet1.xml", sheet)]);
    let limits = InventoryLimits {
        max_cells: 2,
        ..InventoryLimits::default()
    };
    assert!(matches!(
        inventory_ooxml_with_limits(&bytes, limits),
        Err(InventoryError::ResourceLimit(_))
    ));

    let sheet = r#"<worksheet><sheetData/><mergeCells count="2">
<mergeCell ref="A1:B1"/><mergeCell ref="C1:D1"/>
</mergeCells></worksheet>"#;
    let bytes = workbook_package(&[("xl/worksheets/sheet1.xml", sheet)]);
    let limits = InventoryLimits {
        max_structural_records: 1,
        ..InventoryLimits::default()
    };
    assert!(matches!(
        inventory_ooxml_with_limits(&bytes, limits),
        Err(InventoryError::ResourceLimit(_))
    ));
}

#[test]
fn matches_the_public_problematic_fixture() {
    let fixture = include_bytes!("../../../test-fixtures/problematic-import.xlsx");
    let inventory = inventory_ooxml(fixture).unwrap();

    assert_eq!(inventory.date_system, DateSystem::Excel1900);
    assert_eq!(
        inventory
            .sheets
            .iter()
            .map(|sheet| sheet.name.as_str())
            .collect::<Vec<_>>(),
        ["Cabeçalho deslocado", "Regiões lado a lado"]
    );
    assert_eq!(
        inventory.sheets[0].declared_dimension.as_deref(),
        Some("A1:G8")
    );
    assert_eq!(
        inventory.sheets[0].actual_dimension.as_ref().unwrap().end,
        "G8"
    );
    assert_eq!(
        inventory.sheets[1].declared_dimension.as_deref(),
        Some("A1:F4")
    );
    assert_eq!(
        inventory.sheets[1].actual_dimension.as_ref().unwrap().end,
        "F4"
    );
    assert!(
        inventory
            .sheets
            .iter()
            .any(|sheet| sheet.merged_ranges.iter().any(|range| range == "A1:F1"))
    );
    assert!(
        inventory
            .sheets
            .iter()
            .any(|sheet| !sheet.hidden_rows.is_empty())
    );
    assert!(
        inventory
            .sheets
            .iter()
            .any(|sheet| !sheet.hidden_columns.is_empty())
    );
    let first_sheet = &inventory.sheets[0];
    assert_eq!(first_sheet.cells.len(), 34);
    let header = first_sheet
        .cells
        .iter()
        .find(|cell| cell.address == "A4")
        .unwrap();
    assert_eq!(header.raw_value, Some(CellValue::String("Data".into())));
    let formula = first_sheet
        .cells
        .iter()
        .find(|cell| cell.address == "G5")
        .unwrap();
    assert_eq!(formula.formula.as_deref(), Some("=E5"));
    assert_eq!(formula.raw_value, Some(CellValue::Number(1234.56)));
}

#[test]
fn serializes_the_version_three_contract_keys() {
    let sheet = r#"<worksheet><sheetData><row r="1" hidden="1">
<c r="A1"><v>1</v></c></row></sheetData><mergeCells><mergeCell ref="A1:B1"/></mergeCells></worksheet>"#;
    let bytes = workbook_package(&[("xl/worksheets/sheet1.xml", sheet)]);
    let json = serde_json::to_value(inventory_ooxml(&bytes).unwrap()).unwrap();

    assert_eq!(json["schemaVersion"], "3.0.0");
    assert_eq!(json["archive"]["limits"]["maxStructuralRecords"], 500_000);
    assert_eq!(json["sheets"][0]["mergedRanges"][0], "A1:B1");
    assert_eq!(json["sheets"][0]["hiddenRows"][0], 1);
    assert!(json["sheets"][0]["hiddenColumns"].is_array());
}
