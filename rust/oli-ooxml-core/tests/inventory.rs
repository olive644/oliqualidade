use std::io::{Cursor, Write};

use oli_ooxml_core::{
    DateSystem, InventoryError, InventoryLimits, SheetState, inventory_ooxml,
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
    let sheet1 = r#"<worksheet><dimension ref="A1:Z99"/><sheetData>
<row r="2"><c r="B2"><v>1</v></c><c r="D2"><v>2</v></c></row>
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
    assert!(
        inventory
            .diagnostics
            .iter()
            .any(|item| item.code == "dimension-mismatch")
    );
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
}
