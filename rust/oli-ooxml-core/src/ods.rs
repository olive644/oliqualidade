//! Inventário complementar para OpenDocument Spreadsheet (ODS), o formato
//! universal (ISO/IEC 26300) aceito hoje apenas pelo SheetJS no caminho
//! TypeScript. Reaproveita a validação de pacote ZIP, os limites e o modelo
//! de inventário já usados pelo núcleo OOXML; documenta as próprias lacunas
//! em vez de inventar comportamento não implementado.
//!
//! Células e linhas repetidas (`table:number-columns-repeated`,
//! `table:number-rows-repeated`) são representadas de forma compacta e sem
//! perda: um único registro de célula carrega `repeatColumns`/`repeatRows`
//! quando o bloco tem mais de uma ocorrência, em vez de materializar cada
//! célula individualmente ou descartar a repetição. `actualDimension` e a
//! contagem de células refletem a extensão lógica real do bloco, não apenas
//! a âncora. Isso preserva o dado, evita laços proporcionais a contadores
//! hostis de repetição (o custo continua O(1) por elemento do XML) e ainda
//! usa o limite de células do pacote sobre a extensão lógica, não sobre o
//! número de registros JSON.

use std::io::Cursor;

use quick_xml::{Reader, events::Event};
use zip::ZipArchive;

use crate::{
    ActualDimension, CellInventory, CellType, CellValue, DateSystem, Diagnostic, HiddenColumnRange,
    InventoryError, InventoryLimits, SheetInventory, SheetState, WorkbookInventory, attributes,
    count_event, encode_cell_reference, read_part, validate_archive,
};

const CONTENT_PART: &str = "content.xml";
const MAX_COLUMN: u32 = 16_384;
const MAX_ROW: u32 = 1_048_576;

pub fn inventory_ods(bytes: &[u8]) -> Result<WorkbookInventory, InventoryError> {
    inventory_ods_with_limits(bytes, InventoryLimits::default())
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn inventory_ods_json(bytes: &[u8]) -> Result<String, wasm_bindgen::JsValue> {
    let inventory = inventory_ods(bytes)
        .map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))?;
    serde_json::to_string(&inventory)
        .map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))
}

pub fn inventory_ods_with_limits(
    bytes: &[u8],
    limits: InventoryLimits,
) -> Result<WorkbookInventory, InventoryError> {
    let mut archive = ZipArchive::new(Cursor::new(bytes))?;
    let (archive_inventory, part_indexes) = validate_archive(&mut archive, limits)?;
    let content_xml = read_part(&mut archive, &part_indexes, CONTENT_PART, limits)?;
    let (sheets, diagnostics) = parse_spreadsheet(&content_xml, limits)?;

    Ok(WorkbookInventory {
        schema_version: crate::CONTRACT_VERSION,
        format: "ods",
        // ODF grava data/hora como texto ISO 8601 em `office:date-value`;
        // não existe sistema de série 1900/1904 a resolver.
        date_system: DateSystem::NotApplicable,
        archive: archive_inventory,
        sheets,
        diagnostics,
    })
}

#[derive(Debug, Default)]
struct CellTemplate {
    value_type: Option<String>,
    value: Option<String>,
    date_value: Option<String>,
    boolean_value: Option<String>,
    string_value: Option<String>,
    formula: Option<String>,
    text: String,
    columns_repeated: u32,
    columns_spanned: u32,
    rows_spanned: u32,
    covered: bool,
}

#[derive(Debug, Default)]
struct SheetBuilder {
    name: String,
    cells: Vec<CellInventory>,
    merged_ranges: Vec<String>,
    hidden_rows: Vec<u32>,
    hidden_columns: Vec<HiddenColumnRange>,
    bounds: Option<(u32, u32, u32, u32)>,
    cell_count: u64,
}

fn parse_spreadsheet(
    xml: &[u8],
    limits: InventoryLimits,
) -> Result<(Vec<SheetInventory>, Vec<Diagnostic>), InventoryError> {
    let part = CONTENT_PART;
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(false);

    let mut sheets = Vec::new();
    let diagnostics = Vec::new();
    let mut events = 0_u64;

    let mut sheet: Option<SheetBuilder> = None;
    let mut column_cursor = 1_u32;
    let mut row_cursor = 0_u32;
    let mut row_repeated = 1_u32;
    let mut row_hidden = false;
    let mut row_cell_templates: Vec<CellTemplate> = Vec::new();
    let mut current_cell: Option<CellTemplate> = None;
    let mut in_paragraph = false;
    let mut text_bytes = 0_u64;
    let mut workbook_cell_count = 0_u64;

    loop {
        let event = reader.read_event().map_err(|source| InventoryError::Xml {
            part: part.into(),
            source,
        })?;
        count_event(&mut events, limits, part)?;
        match event {
            Event::Start(ref element) | Event::Empty(ref element)
                if element.local_name().as_ref() == b"table" =>
            {
                if let Some(builder) = sheet.take() {
                    finish_sheet(builder, &mut sheets);
                }
                if sheets.len() + 1 > limits.max_sheets {
                    return Err(InventoryError::ResourceLimit(format!(
                        "o documento possui mais de {} abas",
                        limits.max_sheets
                    )));
                }
                let attrs = attributes(element, reader.decoder(), part)?;
                let name = attrs
                    .get("name")
                    .cloned()
                    .unwrap_or_else(|| format!("Sheet{}", sheets.len() + 1));
                column_cursor = 1;
                row_cursor = 0;
                sheet = Some(SheetBuilder {
                    name,
                    ..Default::default()
                });
                if matches!(event, Event::Empty(_))
                    && let Some(builder) = sheet.take()
                {
                    finish_sheet(builder, &mut sheets);
                }
            }
            Event::Start(ref element) | Event::Empty(ref element)
                if element.local_name().as_ref() == b"table-column" =>
            {
                let attrs = attributes(element, reader.decoder(), part)?;
                let repeated = attrs
                    .get("number-columns-repeated")
                    .and_then(|value| value.parse::<u32>().ok())
                    .unwrap_or(1)
                    .max(1);
                let hidden = attrs
                    .get("visibility")
                    .is_some_and(|value| value == "collapse" || value == "filter");
                let end = column_cursor.saturating_add(repeated - 1).min(MAX_COLUMN);
                if hidden && let Some(sheet) = sheet.as_mut() {
                    sheet.hidden_columns.push(HiddenColumnRange {
                        start: column_cursor.min(MAX_COLUMN),
                        end,
                    });
                }
                column_cursor = column_cursor.saturating_add(repeated).min(MAX_COLUMN + 1);
            }
            Event::Start(ref element)
                if element.local_name().as_ref() == b"table-row" && sheet.is_some() =>
            {
                let attrs = attributes(element, reader.decoder(), part)?;
                row_repeated = attrs
                    .get("number-rows-repeated")
                    .and_then(|value| value.parse::<u32>().ok())
                    .unwrap_or(1)
                    .max(1);
                row_hidden = attrs
                    .get("visibility")
                    .is_some_and(|value| value == "collapse" || value == "filter");
                row_cell_templates.clear();
            }
            Event::Empty(ref element)
                if element.local_name().as_ref() == b"table-row" && sheet.is_some() =>
            {
                let attrs = attributes(element, reader.decoder(), part)?;
                let repeated = attrs
                    .get("number-rows-repeated")
                    .and_then(|value| value.parse::<u32>().ok())
                    .unwrap_or(1)
                    .max(1);
                let hidden = attrs
                    .get("visibility")
                    .is_some_and(|value| value == "collapse" || value == "filter");
                close_row(
                    sheet.as_mut().expect("guarded"),
                    &mut row_cursor,
                    repeated,
                    hidden,
                    &[],
                    limits,
                )?;
            }
            Event::Start(ref element) | Event::Empty(ref element)
                if matches!(
                    element.local_name().as_ref(),
                    b"table-cell" | b"covered-table-cell"
                ) && sheet.is_some() =>
            {
                let covered = element.local_name().as_ref() == b"covered-table-cell";
                let attrs = attributes(element, reader.decoder(), part)?;
                let template = CellTemplate {
                    value_type: attrs.get("value-type").cloned(),
                    value: attrs.get("value").cloned(),
                    date_value: attrs.get("date-value").cloned(),
                    boolean_value: attrs.get("boolean-value").cloned(),
                    string_value: attrs.get("string-value").cloned(),
                    formula: attrs.get("formula").map(|value| normalize_formula(value)),
                    text: String::new(),
                    columns_repeated: attrs
                        .get("number-columns-repeated")
                        .and_then(|value| value.parse::<u32>().ok())
                        .unwrap_or(1)
                        .max(1),
                    columns_spanned: attrs
                        .get("number-columns-spanned")
                        .and_then(|value| value.parse::<u32>().ok())
                        .unwrap_or(1)
                        .max(1),
                    rows_spanned: attrs
                        .get("number-rows-spanned")
                        .and_then(|value| value.parse::<u32>().ok())
                        .unwrap_or(1)
                        .max(1),
                    covered,
                };
                if matches!(event, Event::Empty(_)) {
                    row_cell_templates.push(template);
                } else {
                    current_cell = Some(template);
                }
            }
            Event::Start(ref element)
                if current_cell.is_some() && element.local_name().as_ref() == b"p" =>
            {
                in_paragraph = true;
                if let Some(cell) = current_cell.as_mut()
                    && !cell.text.is_empty()
                {
                    cell.text.push('\n');
                }
            }
            Event::Text(ref text) if current_cell.is_some() && in_paragraph => {
                let decoded = text.decode().map_err(|source| InventoryError::Xml {
                    part: part.into(),
                    source: source.into(),
                })?;
                text_bytes = text_bytes
                    .checked_add(decoded.len() as u64)
                    .ok_or_else(|| {
                        InventoryError::ResourceLimit("contagem de texto excedeu u64".into())
                    })?;
                if text_bytes > limits.max_text_bytes {
                    return Err(InventoryError::ResourceLimit(format!(
                        "o pacote excedeu {} bytes de texto",
                        limits.max_text_bytes
                    )));
                }
                current_cell
                    .as_mut()
                    .expect("guarded")
                    .text
                    .push_str(&decoded);
            }
            Event::End(ref element)
                if element.local_name().as_ref() == b"p" && current_cell.is_some() =>
            {
                in_paragraph = false;
            }
            Event::End(ref element)
                if matches!(
                    element.local_name().as_ref(),
                    b"table-cell" | b"covered-table-cell"
                ) =>
            {
                if let Some(template) = current_cell.take() {
                    row_cell_templates.push(template);
                }
            }
            Event::End(ref element)
                if element.local_name().as_ref() == b"table-row" && sheet.is_some() =>
            {
                let templates = std::mem::take(&mut row_cell_templates);
                close_row(
                    sheet.as_mut().expect("guarded"),
                    &mut row_cursor,
                    row_repeated,
                    row_hidden,
                    &templates,
                    limits,
                )?;
            }
            Event::End(ref element)
                if element.local_name().as_ref() == b"table" && sheet.is_some() =>
            {
                if let Some(builder) = sheet.take() {
                    workbook_cell_count = workbook_cell_count
                        .checked_add(builder.cell_count)
                        .ok_or_else(|| {
                            InventoryError::ResourceLimit("contagem de células excedeu u64".into())
                        })?;
                    if workbook_cell_count > limits.max_cells {
                        return Err(InventoryError::ResourceLimit(format!(
                            "o documento possui mais de {} células",
                            limits.max_cells
                        )));
                    }
                    finish_sheet(builder, &mut sheets);
                }
            }
            Event::DocType(_) => {
                return Err(InventoryError::ResourceLimit(
                    "DOCTYPE não é permitido em partes ODF".into(),
                ));
            }
            Event::Eof => break,
            _ => {}
        }
    }

    if let Some(builder) = sheet.take() {
        finish_sheet(builder, &mut sheets);
    }

    Ok((sheets, diagnostics))
}

fn close_row(
    sheet: &mut SheetBuilder,
    row_cursor: &mut u32,
    repeated: u32,
    hidden: bool,
    templates: &[CellTemplate],
    limits: InventoryLimits,
) -> Result<(), InventoryError> {
    let row_number = row_cursor.saturating_add(1).min(MAX_ROW);
    *row_cursor = row_cursor.saturating_add(repeated).min(MAX_ROW);

    if hidden {
        sheet.hidden_rows.push(row_number);
        if sheet.hidden_rows.len() as u64 > limits.max_structural_records {
            return Err(InventoryError::ResourceLimit(format!(
                "a aba '{}' possui mais de {} registros estruturais",
                sheet.name, limits.max_structural_records
            )));
        }
    }

    let mut column_cursor = 1_u32;
    for template in templates {
        let is_blank = template.covered
            || (template.value_type.is_none()
                && template.value.is_none()
                && template.date_value.is_none()
                && template.boolean_value.is_none()
                && template.string_value.is_none()
                && template.formula.is_none()
                && template.text.is_empty());

        if !is_blank {
            // Um bloco repetido conta como sua extensão lógica real, não
            // como uma única célula: uma célula repetida 5.000 vezes numa
            // linha repetida 10.000 vezes vale 50.000.000 células, e o
            // limite protege exatamente esse total, não a contagem de
            // registros JSON (que continua sendo O(1)).
            let logical_cells = u64::from(template.columns_repeated) * u64::from(repeated);
            sheet.cell_count = sheet.cell_count.checked_add(logical_cells).ok_or_else(|| {
                InventoryError::ResourceLimit("contagem de células excedeu u64".into())
            })?;
            if sheet.cell_count > limits.max_cells {
                return Err(InventoryError::ResourceLimit(format!(
                    "a aba '{}' possui mais de {} células",
                    sheet.name, limits.max_cells
                )));
            }
            let address = encode_cell_reference(column_cursor.min(MAX_COLUMN), row_number);
            let end_col = column_cursor
                .saturating_add(template.columns_repeated.saturating_sub(1))
                .min(MAX_COLUMN);
            let end_row = row_number
                .saturating_add(repeated.saturating_sub(1))
                .min(MAX_ROW);
            sheet.bounds = Some(match sheet.bounds {
                Some((min_col, min_row, max_col, max_row)) => (
                    min_col.min(column_cursor),
                    min_row.min(row_number),
                    max_col.max(end_col),
                    max_row.max(end_row),
                ),
                None => (column_cursor, row_number, end_col, end_row),
            });
            sheet.cells.push(build_cell(&address, template, repeated));

            if template.columns_spanned > 1 || template.rows_spanned > 1 {
                let merge_end_col = column_cursor
                    .saturating_add(template.columns_spanned - 1)
                    .min(MAX_COLUMN);
                let merge_end_row = row_number
                    .saturating_add(template.rows_spanned - 1)
                    .min(MAX_ROW);
                sheet.merged_ranges.push(format!(
                    "{}:{}",
                    address,
                    encode_cell_reference(merge_end_col, merge_end_row)
                ));
            }
        }
        column_cursor = column_cursor
            .saturating_add(template.columns_repeated)
            .min(MAX_COLUMN + 1);
    }
    Ok(())
}

fn build_cell(address: &str, template: &CellTemplate, row_repeated: u32) -> CellInventory {
    let value_type = template
        .value_type
        .as_deref()
        .unwrap_or(if template.text.is_empty() {
            ""
        } else {
            "string"
        });
    let date_value = template.date_value.as_deref().map(normalize_date_value);

    let (cell_type, raw_value) = match value_type {
        "float" | "percentage" | "currency" => match template
            .value
            .as_deref()
            .and_then(|value| value.parse::<f64>().ok())
        {
            Some(value) => (CellType::Number, Some(CellValue::Number(value))),
            None => (CellType::Blank, None),
        },
        "boolean" => (
            CellType::Boolean,
            Some(CellValue::Boolean(
                template.boolean_value.as_deref() == Some("true"),
            )),
        ),
        "date" | "time" => (
            CellType::Date,
            date_value
                .clone()
                .map(CellValue::String)
                .or_else(|| Some(CellValue::String(template.text.clone()))),
        ),
        "string" => (
            CellType::String,
            Some(CellValue::String(
                template
                    .string_value
                    .clone()
                    .unwrap_or_else(|| template.text.clone()),
            )),
        ),
        _ if template.formula.is_some() => (
            CellType::String,
            Some(CellValue::String(template.text.clone())),
        ),
        _ => (CellType::Blank, None),
    };

    let display_value = match (&cell_type, &raw_value, &date_value) {
        (CellType::Date, _, Some(iso)) => iso.clone(),
        (_, Some(CellValue::String(value)), _) => value.clone(),
        (_, Some(CellValue::Number(value)), _) if value_type == "percentage" => {
            format!("{:.2}%", value * 100.0)
        }
        (_, Some(CellValue::Number(value)), _) => value.to_string(),
        (_, Some(CellValue::Boolean(value)), _) => value.to_string(),
        _ => String::new(),
    };

    CellInventory {
        address: address.to_owned(),
        cell_type,
        raw_value,
        display_value,
        style_index: 0,
        number_format: None,
        date_value,
        formula: template.formula.clone(),
        repeat_columns: (template.columns_repeated > 1).then_some(template.columns_repeated),
        repeat_rows: (row_repeated > 1).then_some(row_repeated),
    }
}

/// ODF permite `office:date-value` só com data (`2026-08-14`) ou com data e
/// hora (`2026-08-14T13:30:00`). O contrato compartilhado com o núcleo OOXML
/// sempre emite data e hora; horário ausente é normalizado para meia-noite.
fn normalize_date_value(raw: &str) -> String {
    if raw.contains('T') {
        raw.to_owned()
    } else {
        format!("{raw}T00:00:00")
    }
}

fn finish_sheet(builder: SheetBuilder, sheets: &mut Vec<SheetInventory>) {
    let actual_dimension =
        builder
            .bounds
            .map(|(min_col, min_row, max_col, max_row)| ActualDimension {
                start: encode_cell_reference(min_col, min_row),
                end: encode_cell_reference(max_col, max_row),
                rows: max_row - min_row + 1,
                columns: max_col - min_col + 1,
                cell_count: builder.cell_count,
            });
    sheets.push(SheetInventory {
        name: builder.name,
        sheet_id: None,
        relationship_id: String::new(),
        path: None,
        state: SheetState::Visible,
        declared_dimension: None,
        actual_dimension,
        merged_ranges: builder.merged_ranges,
        hidden_rows: builder.hidden_rows,
        hidden_columns: builder.hidden_columns,
        cells: builder.cells,
    });
}

fn normalize_formula(raw: &str) -> String {
    let trimmed = raw.trim();
    let without_namespace = trimmed.strip_prefix("of:").unwrap_or(trimmed);
    if let Some(stripped) = without_namespace.strip_prefix('=') {
        format!("={stripped}")
    } else {
        format!("={without_namespace}")
    }
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn normalizes_formula_prefixes() {
        assert_eq!(normalize_formula("of:=SUM([.A1:.A2])"), "=SUM([.A1:.A2])");
        assert_eq!(normalize_formula("=A1+A2"), "=A1+A2");
    }
}
