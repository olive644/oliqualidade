use std::{
    collections::{HashMap, HashSet},
    io::{Cursor, Read, Seek},
    path::Component,
};

use quick_xml::{
    Reader, XmlVersion, encoding::Decoder, escape::unescape, events::BytesStart, events::Event,
};
use serde::Serialize;
use thiserror::Error;
use zip::ZipArchive;

mod excel_date;
mod ods;

use excel_date::{format_excel_date, is_date_format, parse_excel_serial};

pub use ods::{inventory_ods, inventory_ods_with_limits};

pub const CONTRACT_VERSION: &str = "3.0.0";
const WORKBOOK_PART: &str = "xl/workbook.xml";
const WORKBOOK_RELS_PART: &str = "xl/_rels/workbook.xml.rels";
const SHARED_STRINGS_PART: &str = "xl/sharedStrings.xml";
const STYLES_PART: &str = "xl/styles.xml";

#[derive(Debug, Clone, Copy)]
pub struct InventoryLimits {
    pub max_entries: usize,
    pub max_sheets: usize,
    pub max_cells: u64,
    pub max_shared_strings: usize,
    pub max_structural_records: u64,
    pub max_text_bytes: u64,
    pub max_total_uncompressed_bytes: u64,
    pub max_entry_uncompressed_bytes: u64,
    pub suspicious_ratio_min_bytes: u64,
    pub max_compression_ratio: f64,
    pub max_xml_events: u64,
}

impl Default for InventoryLimits {
    fn default() -> Self {
        Self {
            max_entries: 10_000,
            max_sheets: 100,
            max_cells: 2_000_000,
            max_shared_strings: 2_000_000,
            max_structural_records: 500_000,
            max_text_bytes: 256 * 1024 * 1024,
            max_total_uncompressed_bytes: 1024 * 1024 * 1024,
            max_entry_uncompressed_bytes: 512 * 1024 * 1024,
            suspicious_ratio_min_bytes: 50 * 1024 * 1024,
            max_compression_ratio: 1000.0,
            max_xml_events: 10_000_000,
        }
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkbookInventory {
    pub schema_version: &'static str,
    pub format: &'static str,
    pub date_system: DateSystem,
    pub archive: ArchiveInventory,
    pub sheets: Vec<SheetInventory>,
    pub diagnostics: Vec<Diagnostic>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveInventory {
    pub entries: usize,
    pub compressed_bytes: u64,
    pub uncompressed_bytes: u64,
    pub max_compression_ratio: f64,
    pub limits: AppliedLimits,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppliedLimits {
    pub max_entries: usize,
    pub max_sheets: usize,
    pub max_cells: u64,
    pub max_shared_strings: usize,
    pub max_structural_records: u64,
    pub max_text_bytes: u64,
    pub max_total_uncompressed_bytes: u64,
    pub max_entry_uncompressed_bytes: u64,
    pub suspicious_ratio_min_bytes: u64,
    pub max_compression_ratio: f64,
    pub max_xml_events: u64,
}

impl From<InventoryLimits> for AppliedLimits {
    fn from(value: InventoryLimits) -> Self {
        Self {
            max_entries: value.max_entries,
            max_sheets: value.max_sheets,
            max_cells: value.max_cells,
            max_shared_strings: value.max_shared_strings,
            max_structural_records: value.max_structural_records,
            max_text_bytes: value.max_text_bytes,
            max_total_uncompressed_bytes: value.max_total_uncompressed_bytes,
            max_entry_uncompressed_bytes: value.max_entry_uncompressed_bytes,
            suspicious_ratio_min_bytes: value.suspicious_ratio_min_bytes,
            max_compression_ratio: value.max_compression_ratio,
            max_xml_events: value.max_xml_events,
        }
    }
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
pub enum DateSystem {
    #[serde(rename = "1900")]
    Excel1900,
    #[serde(rename = "1904")]
    Excel1904,
    /// Formatos sem sistema de datas serial do Excel (ex.: ODS, que grava
    /// data/hora como texto ISO 8601 direto em `office:date-value`). Emitir
    /// `Excel1900` por omissão nesses formatos afirmaria uma convenção que
    /// nunca é usada nem interpretada; este estado é explícito em vez disso.
    #[serde(rename = "notApplicable")]
    NotApplicable,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SheetInventory {
    pub name: String,
    pub sheet_id: Option<String>,
    pub relationship_id: String,
    pub path: Option<String>,
    pub state: SheetState,
    pub declared_dimension: Option<String>,
    pub actual_dimension: Option<ActualDimension>,
    pub merged_ranges: Vec<String>,
    pub hidden_rows: Vec<u32>,
    pub hidden_columns: Vec<HiddenColumnRange>,
    pub cells: Vec<CellInventory>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct HiddenColumnRange {
    pub start: u32,
    pub end: u32,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CellInventory {
    pub address: String,
    pub cell_type: CellType,
    pub raw_value: Option<CellValue>,
    pub display_value: String,
    pub style_index: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number_format: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub date_value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub formula: Option<String>,
    /// Formatos com células repetidas (ODS `table:number-columns-repeated` /
    /// `table:number-rows-repeated`) representam um bloco retangular de
    /// células idênticas de forma compacta em vez de materializar cada
    /// ocorrência: `address` é o canto superior esquerdo do bloco e estes
    /// campos informam a largura/altura real. `None`/omitido equivale a 1
    /// (sem repetição); nunca aparece para OOXML, que não tem este conceito.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repeat_columns: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repeat_rows: Option<u32>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CellType {
    Blank,
    Number,
    Boolean,
    String,
    Error,
    Date,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(untagged)]
pub enum CellValue {
    String(String),
    Number(f64),
    Boolean(bool),
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum SheetState {
    Visible,
    Hidden,
    VeryHidden,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ActualDimension {
    pub start: String,
    pub end: String,
    pub rows: u32,
    pub columns: u32,
    pub cell_count: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostic {
    pub code: &'static str,
    pub severity: DiagnosticSeverity,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sheet: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DiagnosticSeverity {
    Info,
    Warning,
}

#[derive(Debug, Error)]
pub enum InventoryError {
    #[error("invalid ZIP package: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("invalid XML in {part}: {source}")]
    Xml {
        part: String,
        #[source]
        source: quick_xml::Error,
    },
    #[error("required OOXML part is missing: {0}")]
    MissingPart(&'static str),
    #[error("unsafe or duplicate package path: {0}")]
    UnsafePath(String),
    #[error("encrypted ZIP entries are not supported: {0}")]
    EncryptedEntry(String),
    #[error("resource limit exceeded: {0}")]
    ResourceLimit(String),
    #[error("I/O error while reading {part}: {source}")]
    Io {
        part: String,
        #[source]
        source: std::io::Error,
    },
}

#[derive(Debug)]
struct WorkbookSheet {
    name: String,
    sheet_id: Option<String>,
    relationship_id: String,
    state: SheetState,
}

#[derive(Debug)]
struct Relationship {
    target: String,
    external: bool,
}

#[derive(Debug)]
struct CellBuilder {
    address: String,
    data_type: String,
    style_index: u32,
    value_text: String,
    inline_text: String,
    formula_text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CellTextTarget {
    Value,
    Inline,
    Formula,
}

#[derive(Debug, Default)]
struct ParsedWorksheet {
    declared_dimension: Option<String>,
    actual_dimension: Option<ActualDimension>,
    merged_ranges: Vec<String>,
    hidden_rows: Vec<u32>,
    hidden_columns: Vec<HiddenColumnRange>,
    cells: Vec<CellInventory>,
}

#[derive(Debug, Clone, Copy)]
struct WorksheetResources<'a> {
    shared_strings: &'a [String],
    style_formats: &'a [String],
    date_system: DateSystem,
}

pub fn inventory_ooxml(bytes: &[u8]) -> Result<WorkbookInventory, InventoryError> {
    inventory_ooxml_with_limits(bytes, InventoryLimits::default())
}

#[cfg(target_arch = "wasm32")]
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn inventory_ooxml_json(bytes: &[u8]) -> Result<String, wasm_bindgen::JsValue> {
    let inventory = inventory_ooxml(bytes)
        .map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))?;
    serde_json::to_string(&inventory)
        .map_err(|error| wasm_bindgen::JsValue::from_str(&error.to_string()))
}

pub fn inventory_ooxml_with_limits(
    bytes: &[u8],
    limits: InventoryLimits,
) -> Result<WorkbookInventory, InventoryError> {
    let mut archive = ZipArchive::new(Cursor::new(bytes))?;
    let (archive_inventory, part_indexes) = validate_archive(&mut archive, limits)?;
    let workbook_xml = read_part(&mut archive, &part_indexes, WORKBOOK_PART, limits)?;
    let relationships_xml = read_part(&mut archive, &part_indexes, WORKBOOK_RELS_PART, limits)?;
    let (date_system, workbook_sheets) = parse_workbook(&workbook_xml, limits)?;
    let relationships = parse_relationships(&relationships_xml, limits)?;
    let shared_strings =
        read_optional_part(&mut archive, &part_indexes, SHARED_STRINGS_PART, limits)?
            .map(|xml| parse_shared_strings(&xml, limits))
            .transpose()?
            .unwrap_or_default();
    let style_formats = read_optional_part(&mut archive, &part_indexes, STYLES_PART, limits)?
        .map(|xml| parse_style_formats(&xml, limits))
        .transpose()?
        .unwrap_or_else(|| vec!["General".to_owned()]);
    let mut diagnostics = Vec::new();
    let mut sheets = Vec::with_capacity(workbook_sheets.len());
    let mut workbook_cell_count = 0_u64;

    for sheet in workbook_sheets {
        let path = relationships
            .get(&sheet.relationship_id)
            .filter(|relationship| !relationship.external)
            .and_then(|relationship| resolve_relationship_target("xl", &relationship.target));

        let parsed = if let Some(path) = path.as_deref() {
            if part_indexes.contains_key(path) {
                let xml = read_part(&mut archive, &part_indexes, path, limits)?;
                let parsed = parse_worksheet(
                    &xml,
                    path,
                    limits,
                    &sheet.name,
                    WorksheetResources {
                        shared_strings: &shared_strings,
                        style_formats: &style_formats,
                        date_system,
                    },
                    &mut diagnostics,
                )?;
                workbook_cell_count = workbook_cell_count
                    .checked_add(parsed.cells.len() as u64)
                    .ok_or_else(|| {
                        InventoryError::ResourceLimit("contagem de células excedeu u64".into())
                    })?;
                if workbook_cell_count > limits.max_cells {
                    return Err(InventoryError::ResourceLimit(format!(
                        "o workbook possui mais de {} células",
                        limits.max_cells
                    )));
                }
                parsed
            } else {
                diagnostics.push(Diagnostic {
                    code: "missing-sheet-part",
                    severity: DiagnosticSeverity::Warning,
                    message: format!("A parte OOXML '{path}' não existe no pacote."),
                    sheet: Some(sheet.name.clone()),
                });
                ParsedWorksheet::default()
            }
        } else {
            diagnostics.push(Diagnostic {
                code: "unresolved-sheet-relationship",
                severity: DiagnosticSeverity::Warning,
                message: format!(
                    "A relação '{}' da aba não pôde ser resolvida com segurança.",
                    sheet.relationship_id
                ),
                sheet: Some(sheet.name.clone()),
            });
            ParsedWorksheet::default()
        };

        sheets.push(SheetInventory {
            name: sheet.name,
            sheet_id: sheet.sheet_id,
            relationship_id: sheet.relationship_id,
            path,
            state: sheet.state,
            declared_dimension: parsed.declared_dimension,
            actual_dimension: parsed.actual_dimension,
            merged_ranges: parsed.merged_ranges,
            hidden_rows: parsed.hidden_rows,
            hidden_columns: parsed.hidden_columns,
            cells: parsed.cells,
        });
    }

    Ok(WorkbookInventory {
        schema_version: CONTRACT_VERSION,
        format: "ooxml",
        date_system,
        archive: archive_inventory,
        sheets,
        diagnostics,
    })
}

fn validate_archive<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    limits: InventoryLimits,
) -> Result<(ArchiveInventory, HashMap<String, usize>), InventoryError> {
    if archive.has_overlapping_files()? {
        return Err(InventoryError::UnsafePath(
            "o pacote contém entradas ZIP sobrepostas".into(),
        ));
    }
    if archive.len() > limits.max_entries {
        return Err(InventoryError::ResourceLimit(format!(
            "{} entradas excedem o máximo de {}",
            archive.len(),
            limits.max_entries
        )));
    }

    let mut indexes = HashMap::with_capacity(archive.len());
    let mut names = HashSet::with_capacity(archive.len());
    let mut compressed_bytes = 0_u64;
    let mut uncompressed_bytes = 0_u64;
    let mut max_ratio = 0.0_f64;

    for index in 0..archive.len() {
        let file = archive.by_index(index)?;
        let raw_name = file.name().to_owned();
        if raw_name
            .split('/')
            .any(|component| component == "." || component == "..")
        {
            return Err(InventoryError::UnsafePath(raw_name));
        }
        let enclosed = file
            .enclosed_name()
            .ok_or_else(|| InventoryError::UnsafePath(raw_name.clone()))?;
        if enclosed
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
        {
            return Err(InventoryError::UnsafePath(raw_name));
        }
        let normalized = enclosed.to_string_lossy().replace('\\', "/");
        if normalized.is_empty() || normalized.starts_with('/') || !names.insert(normalized.clone())
        {
            return Err(InventoryError::UnsafePath(raw_name));
        }
        if file.encrypted() {
            return Err(InventoryError::EncryptedEntry(normalized));
        }
        if file.size() > limits.max_entry_uncompressed_bytes {
            return Err(InventoryError::ResourceLimit(format!(
                "a entrada '{normalized}' tem {} bytes; máximo {}",
                file.size(),
                limits.max_entry_uncompressed_bytes
            )));
        }
        uncompressed_bytes = uncompressed_bytes.checked_add(file.size()).ok_or_else(|| {
            InventoryError::ResourceLimit("soma de bytes descompactados excedeu u64".into())
        })?;
        compressed_bytes = compressed_bytes
            .checked_add(file.compressed_size())
            .ok_or_else(|| {
                InventoryError::ResourceLimit("soma de bytes compactados excedeu u64".into())
            })?;
        if uncompressed_bytes > limits.max_total_uncompressed_bytes {
            return Err(InventoryError::ResourceLimit(format!(
                "{} bytes descompactados excedem o máximo de {}",
                uncompressed_bytes, limits.max_total_uncompressed_bytes
            )));
        }
        let ratio = if file.size() == 0 {
            0.0
        } else {
            file.size() as f64 / file.compressed_size().max(1) as f64
        };
        max_ratio = max_ratio.max(ratio);
        if file.size() >= limits.suspicious_ratio_min_bytes && ratio > limits.max_compression_ratio
        {
            return Err(InventoryError::ResourceLimit(format!(
                "a entrada '{normalized}' tem razão de compactação {ratio:.1}; máximo {:.1}",
                limits.max_compression_ratio
            )));
        }
        indexes.insert(normalized, index);
    }

    Ok((
        ArchiveInventory {
            entries: archive.len(),
            compressed_bytes,
            uncompressed_bytes,
            max_compression_ratio: max_ratio,
            limits: limits.into(),
        },
        indexes,
    ))
}

fn read_part<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    indexes: &HashMap<String, usize>,
    part: &str,
    limits: InventoryLimits,
) -> Result<Vec<u8>, InventoryError> {
    let index = indexes.get(part).copied().ok_or(match part {
        WORKBOOK_PART => InventoryError::MissingPart(WORKBOOK_PART),
        WORKBOOK_RELS_PART => InventoryError::MissingPart(WORKBOOK_RELS_PART),
        _ => InventoryError::ResourceLimit(format!("parte não indexada: {part}")),
    })?;
    let mut file = archive.by_index(index)?;
    let capacity = usize::try_from(file.size()).unwrap_or(0);
    let mut output = Vec::with_capacity(capacity.min(16 * 1024 * 1024));
    file.by_ref()
        .take(limits.max_entry_uncompressed_bytes + 1)
        .read_to_end(&mut output)
        .map_err(|source| InventoryError::Io {
            part: part.to_owned(),
            source,
        })?;
    if output.len() as u64 > limits.max_entry_uncompressed_bytes {
        return Err(InventoryError::ResourceLimit(format!(
            "a leitura de '{part}' excedeu o limite por entrada"
        )));
    }
    Ok(output)
}

fn read_optional_part<R: Read + Seek>(
    archive: &mut ZipArchive<R>,
    indexes: &HashMap<String, usize>,
    part: &str,
    limits: InventoryLimits,
) -> Result<Option<Vec<u8>>, InventoryError> {
    if !indexes.contains_key(part) {
        return Ok(None);
    }
    read_part(archive, indexes, part, limits).map(Some)
}

fn parse_workbook(
    xml: &[u8],
    limits: InventoryLimits,
) -> Result<(DateSystem, Vec<WorkbookSheet>), InventoryError> {
    let part = WORKBOOK_PART;
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(true);
    let mut date_system = DateSystem::Excel1900;
    let mut sheets = Vec::new();
    let mut events = 0_u64;

    loop {
        let event = reader.read_event().map_err(|source| InventoryError::Xml {
            part: part.into(),
            source,
        })?;
        count_event(&mut events, limits, part)?;
        match event {
            Event::Start(ref element) | Event::Empty(ref element)
                if element.local_name().as_ref() == b"workbookPr" =>
            {
                let attrs = attributes(element, reader.decoder(), part)?;
                if attrs.get("date1904").is_some_and(|value| is_true(value)) {
                    date_system = DateSystem::Excel1904;
                }
            }
            Event::Start(ref element) | Event::Empty(ref element)
                if element.local_name().as_ref() == b"sheet" =>
            {
                let attrs = attributes(element, reader.decoder(), part)?;
                if let (Some(name), Some(relationship_id)) = (attrs.get("name"), attrs.get("id")) {
                    sheets.push(WorkbookSheet {
                        name: name.clone(),
                        sheet_id: attrs.get("sheetId").cloned(),
                        relationship_id: relationship_id.clone(),
                        state: match attrs.get("state").map(String::as_str) {
                            Some("hidden") => SheetState::Hidden,
                            Some("veryHidden") => SheetState::VeryHidden,
                            _ => SheetState::Visible,
                        },
                    });
                    if sheets.len() > limits.max_sheets {
                        return Err(InventoryError::ResourceLimit(format!(
                            "o workbook possui mais de {} abas",
                            limits.max_sheets
                        )));
                    }
                }
            }
            Event::DocType(_) => {
                return Err(InventoryError::ResourceLimit(
                    "DOCTYPE não é permitido em partes OOXML".into(),
                ));
            }
            Event::Eof => break,
            _ => {}
        }
    }
    Ok((date_system, sheets))
}

fn parse_relationships(
    xml: &[u8],
    limits: InventoryLimits,
) -> Result<HashMap<String, Relationship>, InventoryError> {
    let part = WORKBOOK_RELS_PART;
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(true);
    let mut relationships = HashMap::new();
    let mut events = 0_u64;

    loop {
        let event = reader.read_event().map_err(|source| InventoryError::Xml {
            part: part.into(),
            source,
        })?;
        count_event(&mut events, limits, part)?;
        match event {
            Event::Start(ref element) | Event::Empty(ref element)
                if element.local_name().as_ref() == b"Relationship" =>
            {
                let attrs = attributes(element, reader.decoder(), part)?;
                if let (Some(id), Some(target)) = (attrs.get("Id"), attrs.get("Target")) {
                    relationships.insert(
                        id.clone(),
                        Relationship {
                            target: target.clone(),
                            external: attrs
                                .get("TargetMode")
                                .is_some_and(|mode| mode == "External"),
                        },
                    );
                }
            }
            Event::DocType(_) => {
                return Err(InventoryError::ResourceLimit(
                    "DOCTYPE não é permitido em partes OOXML".into(),
                ));
            }
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(relationships)
}

fn parse_worksheet(
    xml: &[u8],
    part: &str,
    limits: InventoryLimits,
    sheet_name: &str,
    resources: WorksheetResources<'_>,
    diagnostics: &mut Vec<Diagnostic>,
) -> Result<ParsedWorksheet, InventoryError> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(false);
    let mut declared_dimension = None;
    let mut bounds: Option<(u32, u32, u32, u32)> = None;
    let mut cell_count = 0_u64;
    let mut cells = Vec::new();
    let mut merged_ranges = Vec::new();
    let mut hidden_rows = Vec::new();
    let mut hidden_columns = Vec::new();
    let mut structural_records = 0_u64;
    let mut current_cell: Option<CellBuilder> = None;
    let mut text_target = None;
    let mut text_bytes = 0_u64;
    let mut events = 0_u64;

    loop {
        let event = reader.read_event().map_err(|source| InventoryError::Xml {
            part: part.into(),
            source,
        })?;
        count_event(&mut events, limits, part)?;
        match event {
            Event::Start(ref element) | Event::Empty(ref element)
                if element.local_name().as_ref() == b"dimension" =>
            {
                declared_dimension = attributes(element, reader.decoder(), part)?
                    .get("ref")
                    .cloned();
            }
            Event::Start(ref element) | Event::Empty(ref element)
                if element.local_name().as_ref() == b"row" =>
            {
                let attrs = attributes(element, reader.decoder(), part)?;
                if attrs.get("hidden").is_some_and(|value| is_true(value)) {
                    push_structural_record(
                        &mut structural_records,
                        limits,
                        sheet_name,
                        "linhas/colunas ocultas e mesclagens",
                    )?;
                    if let Some(row) = attrs
                        .get("r")
                        .and_then(|value| value.parse::<u32>().ok())
                        .filter(|row| (1..=1_048_576).contains(row))
                    {
                        hidden_rows.push(row);
                    } else {
                        push_invalid_structure_diagnostic(
                            diagnostics,
                            sheet_name,
                            "invalid-hidden-row",
                            "Uma linha oculta possui índice inválido e foi ignorada.",
                        );
                    }
                }
            }
            Event::Start(ref element) | Event::Empty(ref element)
                if element.local_name().as_ref() == b"col" =>
            {
                let attrs = attributes(element, reader.decoder(), part)?;
                if attrs.get("hidden").is_some_and(|value| is_true(value)) {
                    push_structural_record(
                        &mut structural_records,
                        limits,
                        sheet_name,
                        "linhas/colunas ocultas e mesclagens",
                    )?;
                    let range = attrs
                        .get("min")
                        .and_then(|value| value.parse::<u32>().ok())
                        .zip(attrs.get("max").and_then(|value| value.parse::<u32>().ok()))
                        .filter(|(start, end)| *start >= 1 && *start <= *end && *end <= 16_384);
                    if let Some((start, end)) = range {
                        hidden_columns.push(HiddenColumnRange { start, end });
                    } else {
                        push_invalid_structure_diagnostic(
                            diagnostics,
                            sheet_name,
                            "invalid-hidden-column-range",
                            "Um intervalo de colunas ocultas é inválido e foi ignorado.",
                        );
                    }
                }
            }
            Event::Start(ref element) | Event::Empty(ref element)
                if element.local_name().as_ref() == b"mergeCell" =>
            {
                push_structural_record(
                    &mut structural_records,
                    limits,
                    sheet_name,
                    "linhas/colunas ocultas e mesclagens",
                )?;
                let reference = attributes(element, reader.decoder(), part)?
                    .get("ref")
                    .cloned();
                if let Some(reference) = reference.filter(|value| is_valid_cell_range(value)) {
                    merged_ranges.push(reference);
                } else {
                    push_invalid_structure_diagnostic(
                        diagnostics,
                        sheet_name,
                        "invalid-merged-range",
                        "Uma mesclagem possui referência inválida e foi ignorada.",
                    );
                }
            }
            Event::Start(ref element) if element.local_name().as_ref() == b"c" => {
                cell_count += 1;
                enforce_cell_limit(cell_count, limits, sheet_name)?;
                current_cell = start_cell(element, reader.decoder(), part, &mut bounds)?;
            }
            Event::Empty(ref element) if element.local_name().as_ref() == b"c" => {
                cell_count += 1;
                enforce_cell_limit(cell_count, limits, sheet_name)?;
                if let Some(builder) = start_cell(element, reader.decoder(), part, &mut bounds)? {
                    cells.push(finish_cell(
                        builder,
                        resources.shared_strings,
                        resources.style_formats,
                        diagnostics,
                        sheet_name,
                        resources.date_system,
                    ));
                }
            }
            Event::Start(ref element) if current_cell.is_some() => {
                text_target = match element.local_name().as_ref() {
                    b"v" => Some(CellTextTarget::Value),
                    b"f" => Some(CellTextTarget::Formula),
                    b"t" => Some(CellTextTarget::Inline),
                    _ => text_target,
                };
            }
            Event::Text(ref text) if current_cell.is_some() && text_target.is_some() => {
                let decoded = text.decode().map_err(|source| InventoryError::Xml {
                    part: part.into(),
                    source: source.into(),
                })?;
                let decoded = unescape(&decoded).map_err(|source| InventoryError::Xml {
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
                        "a aba '{sheet_name}' excedeu {} bytes de texto",
                        limits.max_text_bytes
                    )));
                }
                append_cell_text(
                    current_cell.as_mut().expect("guarded"),
                    text_target,
                    &decoded,
                );
            }
            Event::CData(ref text) if current_cell.is_some() && text_target.is_some() => {
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
                        "a aba '{sheet_name}' excedeu {} bytes de texto",
                        limits.max_text_bytes
                    )));
                }
                append_cell_text(
                    current_cell.as_mut().expect("guarded"),
                    text_target,
                    &decoded,
                );
            }
            Event::GeneralRef(ref reference) if current_cell.is_some() && text_target.is_some() => {
                let resolved = resolve_general_reference(reference, part)?;
                text_bytes = text_bytes
                    .checked_add(resolved.len() as u64)
                    .ok_or_else(|| {
                        InventoryError::ResourceLimit("contagem de texto excedeu u64".into())
                    })?;
                if text_bytes > limits.max_text_bytes {
                    return Err(InventoryError::ResourceLimit(format!(
                        "a aba '{sheet_name}' excedeu {} bytes de texto",
                        limits.max_text_bytes
                    )));
                }
                append_cell_text(
                    current_cell.as_mut().expect("guarded"),
                    text_target,
                    &resolved,
                );
            }
            Event::End(ref element) if current_cell.is_some() => {
                match element.local_name().as_ref() {
                    b"v" | b"f" | b"t" => text_target = None,
                    b"c" => {
                        if let Some(builder) = current_cell.take() {
                            cells.push(finish_cell(
                                builder,
                                resources.shared_strings,
                                resources.style_formats,
                                diagnostics,
                                sheet_name,
                                resources.date_system,
                            ));
                        }
                        text_target = None;
                    }
                    _ => {}
                }
            }
            Event::DocType(_) => {
                return Err(InventoryError::ResourceLimit(
                    "DOCTYPE não é permitido em partes OOXML".into(),
                ));
            }
            Event::Eof => break,
            _ => {}
        }
    }

    let actual_dimension = bounds.map(|(min_col, min_row, max_col, max_row)| ActualDimension {
        start: encode_cell_reference(min_col, min_row),
        end: encode_cell_reference(max_col, max_row),
        rows: max_row - min_row + 1,
        columns: max_col - min_col + 1,
        cell_count,
    });
    if let (Some(declared), Some(actual)) = (&declared_dimension, &actual_dimension) {
        let actual_ref = if actual.start == actual.end {
            actual.start.clone()
        } else {
            format!("{}:{}", actual.start, actual.end)
        };
        if declared != &actual_ref {
            diagnostics.push(Diagnostic {
                code: "dimension-mismatch",
                severity: DiagnosticSeverity::Info,
                message: format!(
                    "A dimensão declarada é '{declared}', mas as células ocupam '{actual_ref}'."
                ),
                sheet: Some(sheet_name.to_owned()),
            });
        }
    }
    Ok(ParsedWorksheet {
        declared_dimension,
        actual_dimension,
        merged_ranges,
        hidden_rows,
        hidden_columns,
        cells,
    })
}

fn parse_shared_strings(
    xml: &[u8],
    limits: InventoryLimits,
) -> Result<Vec<String>, InventoryError> {
    let part = SHARED_STRINGS_PART;
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(false);
    let mut strings = Vec::new();
    let mut current = None::<String>;
    let mut in_text = false;
    let mut events = 0_u64;
    let mut text_bytes = 0_u64;

    loop {
        let event = reader.read_event().map_err(|source| InventoryError::Xml {
            part: part.into(),
            source,
        })?;
        count_event(&mut events, limits, part)?;
        match event {
            Event::Start(ref element) if element.local_name().as_ref() == b"si" => {
                current = Some(String::new());
            }
            Event::Start(ref element) if element.local_name().as_ref() == b"t" => in_text = true,
            Event::Text(ref text) if current.is_some() && in_text => {
                let decoded = text.decode().map_err(|source| InventoryError::Xml {
                    part: part.into(),
                    source: source.into(),
                })?;
                let decoded = unescape(&decoded).map_err(|source| InventoryError::Xml {
                    part: part.into(),
                    source: source.into(),
                })?;
                add_text_bytes(&mut text_bytes, decoded.len(), limits, part)?;
                current.as_mut().expect("guarded").push_str(&decoded);
            }
            Event::CData(ref text) if current.is_some() && in_text => {
                let decoded = text.decode().map_err(|source| InventoryError::Xml {
                    part: part.into(),
                    source: source.into(),
                })?;
                add_text_bytes(&mut text_bytes, decoded.len(), limits, part)?;
                current.as_mut().expect("guarded").push_str(&decoded);
            }
            Event::GeneralRef(ref reference) if current.is_some() && in_text => {
                let resolved = resolve_general_reference(reference, part)?;
                add_text_bytes(&mut text_bytes, resolved.len(), limits, part)?;
                current.as_mut().expect("guarded").push_str(&resolved);
            }
            Event::End(ref element) if element.local_name().as_ref() == b"t" => in_text = false,
            Event::End(ref element) if element.local_name().as_ref() == b"si" => {
                strings.push(current.take().unwrap_or_default());
                if strings.len() > limits.max_shared_strings {
                    return Err(InventoryError::ResourceLimit(format!(
                        "sharedStrings possui mais de {} itens",
                        limits.max_shared_strings
                    )));
                }
            }
            Event::DocType(_) => {
                return Err(InventoryError::ResourceLimit(
                    "DOCTYPE não é permitido em partes OOXML".into(),
                ));
            }
            Event::Eof => break,
            _ => {}
        }
    }
    Ok(strings)
}

fn parse_style_formats(xml: &[u8], limits: InventoryLimits) -> Result<Vec<String>, InventoryError> {
    let part = STYLES_PART;
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(true);
    let mut custom = HashMap::<u32, String>::new();
    let mut formats = Vec::new();
    let mut in_cell_xfs = false;
    let mut events = 0_u64;

    loop {
        let event = reader.read_event().map_err(|source| InventoryError::Xml {
            part: part.into(),
            source,
        })?;
        count_event(&mut events, limits, part)?;
        match event {
            Event::Start(ref element) if element.local_name().as_ref() == b"cellXfs" => {
                in_cell_xfs = true;
            }
            Event::End(ref element) if element.local_name().as_ref() == b"cellXfs" => {
                in_cell_xfs = false;
            }
            Event::Start(ref element) | Event::Empty(ref element)
                if element.local_name().as_ref() == b"numFmt" =>
            {
                let attrs = attributes(element, reader.decoder(), part)?;
                if let (Some(id), Some(code)) = (attrs.get("numFmtId"), attrs.get("formatCode"))
                    && let Ok(id) = id.parse::<u32>()
                {
                    custom.insert(id, code.clone());
                }
            }
            Event::Start(ref element) | Event::Empty(ref element)
                if in_cell_xfs && element.local_name().as_ref() == b"xf" =>
            {
                let attrs = attributes(element, reader.decoder(), part)?;
                let id = attrs
                    .get("numFmtId")
                    .and_then(|value| value.parse::<u32>().ok())
                    .unwrap_or(0);
                formats.push(
                    custom
                        .get(&id)
                        .cloned()
                        .unwrap_or_else(|| builtin_number_format(id).to_owned()),
                );
            }
            Event::DocType(_) => {
                return Err(InventoryError::ResourceLimit(
                    "DOCTYPE não é permitido em partes OOXML".into(),
                ));
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if formats.is_empty() {
        formats.push("General".to_owned());
    }
    Ok(formats)
}

fn start_cell(
    element: &BytesStart<'_>,
    decoder: Decoder,
    part: &str,
    bounds: &mut Option<(u32, u32, u32, u32)>,
) -> Result<Option<CellBuilder>, InventoryError> {
    let attrs = attributes(element, decoder, part)?;
    let Some(address) = attrs.get("r").cloned() else {
        return Ok(None);
    };
    if let Some((column, row)) = parse_cell_reference(&address) {
        *bounds = Some(match *bounds {
            Some((min_col, min_row, max_col, max_row)) => (
                min_col.min(column),
                min_row.min(row),
                max_col.max(column),
                max_row.max(row),
            ),
            None => (column, row, column, row),
        });
    }
    Ok(Some(CellBuilder {
        address,
        data_type: attrs.get("t").cloned().unwrap_or_else(|| "n".to_owned()),
        style_index: attrs
            .get("s")
            .and_then(|value| value.parse::<u32>().ok())
            .unwrap_or(0),
        value_text: String::new(),
        inline_text: String::new(),
        formula_text: String::new(),
    }))
}

fn append_cell_text(builder: &mut CellBuilder, target: Option<CellTextTarget>, text: &str) {
    match target {
        Some(CellTextTarget::Value) => builder.value_text.push_str(text),
        Some(CellTextTarget::Inline) => builder.inline_text.push_str(text),
        Some(CellTextTarget::Formula) => builder.formula_text.push_str(text),
        None => {}
    }
}

fn finish_cell(
    builder: CellBuilder,
    shared_strings: &[String],
    style_formats: &[String],
    diagnostics: &mut Vec<Diagnostic>,
    sheet_name: &str,
    date_system: DateSystem,
) -> CellInventory {
    let (mut cell_type, raw_value) = match builder.data_type.as_str() {
        "s" => match builder.value_text.parse::<usize>() {
            Ok(index) => match shared_strings.get(index) {
                Some(value) => (CellType::String, Some(CellValue::String(value.clone()))),
                None => {
                    diagnostics.push(Diagnostic {
                        code: "missing-shared-string",
                        severity: DiagnosticSeverity::Warning,
                        message: format!(
                            "A célula '{}' referencia shared string inexistente {}.",
                            builder.address, index
                        ),
                        sheet: Some(sheet_name.to_owned()),
                    });
                    (CellType::String, Some(CellValue::String(String::new())))
                }
            },
            Err(_) => (CellType::String, Some(CellValue::String(String::new()))),
        },
        "inlineStr" => (
            CellType::String,
            Some(CellValue::String(builder.inline_text.clone())),
        ),
        "b" => (
            CellType::Boolean,
            Some(CellValue::Boolean(builder.value_text == "1")),
        ),
        "str" => (
            CellType::String,
            Some(CellValue::String(builder.value_text.clone())),
        ),
        "e" => (
            CellType::Error,
            Some(CellValue::String(builder.value_text.clone())),
        ),
        "d" => (
            CellType::Date,
            Some(CellValue::String(builder.value_text.clone())),
        ),
        _ if builder.value_text.is_empty() => (CellType::Blank, None),
        _ => match builder.value_text.parse::<f64>() {
            Ok(value) if value.is_finite() => (CellType::Number, Some(CellValue::Number(value))),
            _ => (
                CellType::String,
                Some(CellValue::String(builder.value_text.clone())),
            ),
        },
    };
    let number_format = style_formats
        .get(builder.style_index as usize)
        .cloned()
        .unwrap_or_else(|| "General".to_owned());
    let parsed_date = match raw_value.as_ref() {
        Some(CellValue::Number(value)) if is_date_format(&number_format) => {
            parse_excel_serial(*value, date_system)
        }
        _ => None,
    };
    if parsed_date.is_some() {
        cell_type = CellType::Date;
    }
    if parsed_date.is_some_and(|value| value.excel_leap_day) {
        diagnostics.push(Diagnostic {
            code: "excel-1900-leap-day",
            severity: DiagnosticSeverity::Info,
            message: format!(
                "A célula '{}' usa o dia fictício 29/02/1900 preservado pelo Excel.",
                builder.address
            ),
            sheet: Some(sheet_name.to_owned()),
        });
    }
    let display_value = match (raw_value.as_ref(), parsed_date) {
        (Some(CellValue::Number(value)), Some(date)) => {
            format_excel_date(*value, &number_format, date)
        }
        _ => display_cell_value(raw_value.as_ref(), &number_format),
    };
    CellInventory {
        address: builder.address,
        cell_type,
        raw_value,
        display_value,
        style_index: builder.style_index,
        number_format: (number_format != "General").then_some(number_format),
        date_value: parsed_date.and_then(|value| value.iso_value()),
        formula: (!builder.formula_text.is_empty()).then(|| format!("={}", builder.formula_text)),
        repeat_columns: None,
        repeat_rows: None,
    }
}

fn display_cell_value(value: Option<&CellValue>, number_format: &str) -> String {
    match value {
        Some(CellValue::String(value)) => value.clone(),
        Some(CellValue::Boolean(value)) => value.to_string(),
        Some(CellValue::Number(value)) => format_number_with_code(*value, number_format),
        None => String::new(),
    }
}

/// Formatos de decimais fixos, numéricos ("0", "0.00", "0.000", ...) ou
/// percentuais ("0%", "0.00%", "0.000%", ...), com qualquer quantidade de
/// zeros depois do ponto. Achado ao sanitizar planilhas reais do usuário:
/// a versão anterior só reconhecia "0"/"0.00"/"0%"/"0.00%" (4 casos fixos)
/// e tratava qualquer outra contagem de zeros (ex.: "0.0", "0.000") como
/// "General" — perdendo o preenchimento de zeros à direita que o Excel e o
/// leitor TypeScript mostram para esses formatos. Qualquer código que não
/// seja puramente decimais fixos (separador de milhar, cor condicional,
/// texto literal etc.) continua caindo em `format_general_number`.
fn format_number_with_code(value: f64, number_format: &str) -> String {
    let (base, is_percent) = match number_format.strip_suffix('%') {
        Some(base) => (base, true),
        None => (number_format, false),
    };
    if let Some(decimals) = fixed_decimal_places(base) {
        let scaled = if is_percent { value * 100.0 } else { value };
        let formatted = format_fixed_decimals(scaled, decimals);
        return if is_percent {
            format!("{formatted}%")
        } else {
            formatted
        };
    }
    // Só depois do caminho de decimais fixos, e nunca no lugar dele: aquele
    // caminho já está calibrado contra o corpus, e o de baixo existe para
    // recuperar códigos que antes caíam inteiros em "General".
    if let Some(rendered) = format_from_section_code(value, number_format) {
        return rendered;
    }
    format_general_number(value)
}

/// Interpreta um código de formato numérico com seções, literais e separador
/// de milhar.
///
/// A referência não é o Excel, é o `XLSX.SSF.format` do SheetJS: é contra ele
/// que a paridade do corpus compara, célula a célula. Isto **não** é uma
/// reimplementação do SSF, que é bem maior; é a fatia dele que aparece em
/// planilha real de custo e de contabilidade.
///
/// A versão anterior desta função eram duas comparações de igualdade com dois
/// códigos literais achados no corpus. Fechavam o portão sem tornar o leitor
/// correto: bastava trocar a moeda, tirar o espaço escapado ou mudar a
/// quantidade de casas para voltar a cair em "General". Aqui a resposta é
/// derivada do código, então a família inteira funciona.
///
/// Devolve `None` para tudo que não está modelado — cor e condição entre
/// colchetes, notação científica, fração, data, texto. `None` cai no
/// comportamento anterior, que é o único jeito seguro de crescer isto: o que
/// não se sabe formatar continua exatamente como estava.
fn format_from_section_code(value: f64, number_format: &str) -> Option<String> {
    if number_format.is_empty() || number_format == "General" {
        return None;
    }
    let sections = split_format_sections(number_format);
    // Regra de seleção do SSF: uma seção vale para tudo; duas separam
    // não-negativo de negativo; três ou mais isolam o zero.
    let (section, use_absolute) = match (sections.len(), value) {
        (1, _) => (sections[0], false),
        (_, v) if v < 0.0 => (sections.get(1).copied().unwrap_or(sections[0]), true),
        (2, _) => (sections[0], false),
        (_, v) if v == 0.0 => (sections.get(2).copied().unwrap_or(sections[0]), false),
        _ => (sections[0], false),
    };
    let target = if use_absolute { value.abs() } else { value };
    render_format_section(section, target, sections.len() > 1 && value < 0.0)
}

/// Separa as seções de um código de formato pelo `;`, respeitando literal
/// entre aspas e caractere escapado por barra invertida — sem isso, um `;`
/// dentro de `"a;b"` partiria o código no lugar errado.
fn split_format_sections(code: &str) -> Vec<&str> {
    let mut sections = Vec::new();
    let mut start = 0usize;
    let mut quoted = false;
    let mut escaped = false;
    for (index, character) in code.char_indices() {
        if escaped {
            escaped = false;
            continue;
        }
        match character {
            '\\' => escaped = true,
            '"' => quoted = !quoted,
            ';' if !quoted => {
                sections.push(&code[start..index]);
                start = index + character.len_utf8();
            }
            _ => {}
        }
    }
    sections.push(&code[start..]);
    sections
}

/// Desenha uma seção já escolhida.
///
/// `already_signed` diz que a seção veio de um bloco dedicado a negativo, e
/// portanto ela mesma carrega a marca (o sinal escrito, ou os parênteses). Só
/// quando não há bloco dedicado é que o sinal é acrescentado aqui, que é como
/// o SSF se comporta.
fn render_format_section(section: &str, value: f64, already_signed: bool) -> Option<String> {
    let characters: Vec<char> = section.chars().collect();
    let mut rendered = String::new();
    let mut digits: Option<DigitPattern> = None;
    let mut index = 0usize;
    let mut digit_slot = None;
    while index < characters.len() {
        let character = characters[index];
        match character {
            // Não modelado: cor, condição e localidade (`[Red]`, `[>100]`,
            // `[$R$-416]`), notação científica, fração e data.
            '[' | ']' | 'E' | 'e' | '/' => return None,
            'y' | 'm' | 'd' | 'h' | 's' | 'Y' | 'M' | 'D' | 'H' | 'S' | '@' => return None,
            '"' => {
                index += 1;
                while index < characters.len() && characters[index] != '"' {
                    rendered.push(characters[index]);
                    index += 1;
                }
                index += 1;
            }
            '\\' => {
                index += 1;
                if let Some(escaped) = characters.get(index) {
                    rendered.push(*escaped);
                }
                index += 1;
            }
            // `_x` reserva a largura do próximo caractere: o SSF desenha um
            // espaço. `*x` repete o caractere para preencher a coluna, e o
            // SSF não desenha nada.
            '_' => {
                index += 2;
                rendered.push(' ');
            }
            '*' => index += 2,
            '?' => {
                rendered.push(' ');
                index += 1;
            }
            '#' | '0' | ',' | '.' => {
                let start = index;
                while index < characters.len() && matches!(characters[index], '#' | '0' | ',' | '.')
                {
                    index += 1;
                }
                if digits.is_some() {
                    // Dois blocos de dígitos na mesma seção é fração ou algo
                    // fora do que está modelado.
                    return None;
                }
                digits = Some(parse_digit_pattern(&characters[start..index]));
                digit_slot = Some(rendered.len());
            }
            '%' => {
                rendered.push('%');
                index += 1;
            }
            other => {
                rendered.push(other);
                index += 1;
            }
        }
    }

    match (digits, digit_slot) {
        (Some(pattern), Some(slot)) => {
            let scaled = if section.contains('%') {
                value * 100.0
            } else {
                value
            };
            let mut number = format_grouped_fixed(scaled.abs(), pattern.decimals, pattern.grouped);
            if scaled < 0.0 && !already_signed {
                number.insert(0, '-');
            }
            rendered.insert_str(slot, &number);
            Some(rendered)
        }
        // Seção sem nenhum dígito é literal puro, que é justamente o caso da
        // terceira seção do formato contábil ("mostre um traço no zero").
        // Derivar isso do código é o ponto: a versão anterior devolvia a
        // string pronta " -   " sem olhar para o formato.
        (None, _) => Some(rendered),
        _ => None,
    }
}

#[derive(Clone, Copy)]
struct DigitPattern {
    decimals: usize,
    grouped: bool,
}

fn parse_digit_pattern(pattern: &[char]) -> DigitPattern {
    let point = pattern.iter().position(|character| *character == '.');
    let decimals = match point {
        Some(position) => pattern[position + 1..]
            .iter()
            .filter(|character| matches!(character, '0' | '#'))
            .count(),
        None => 0,
    };
    let integer_part = match point {
        Some(position) => &pattern[..position],
        None => pattern,
    };
    DigitPattern {
        decimals,
        grouped: integer_part.contains(&','),
    }
}

/// Formata com casas fixas e, opcionalmente, separador de milhar, na
/// convenção neutra do OOXML (`,` para milhar e `.` para decimal),
/// independente da localidade do navegador — quem traduz para a localidade é
/// a camada de exibição, não o leitor.
///
/// Recebe o valor já em módulo: o sinal é decidido por quem chama, porque
/// depende de a seção de negativo existir ou não. Isso também evita o `-0.00`
/// que a primeira versão produzia, já que ela consultava
/// `is_sign_negative()` — verdadeiro para `-0.0` — depois de tirar o módulo.
fn format_grouped_fixed(value: f64, decimals: usize, grouped: bool) -> String {
    let fixed = format_fixed_decimals(value.abs(), decimals);
    let (integer, fraction) = fixed.split_once('.').unwrap_or((&fixed, ""));
    if !grouped {
        return fixed;
    }
    let mut result = String::with_capacity(fixed.len() + integer.len() / 3);
    for (index, character) in integer.chars().enumerate() {
        if index > 0 && (integer.len() - index) % 3 == 0 {
            result.push(',');
        }
        result.push(character);
    }
    if decimals > 0 {
        result.push('.');
        result.push_str(fraction);
    }
    result
}

/// Arredonda pra exibição com uma quantidade fixa de casas decimais do
/// mesmo jeito que o Excel/SheetJS: escala pelo número de decimais,
/// arredonda pro inteiro mais próximo (metade sempre pra cima em módulo,
/// não o "round half to even" do IEEE 754 puro) e desfaz a escala antes de
/// formatar. Achado real ao sanitizar planilhas do usuário: formatar o
/// valor binário exato direto com `format!("{value:.decimals$}")` diverge
/// do Excel/TypeScript perto do meio do último dígito — ex. 654055.45 com
/// formato "0.0" é armazenado como 654055.44999999995343387127 em f64, e
/// `format!("{:.1}")` nesse valor exato arredonda pra baixo (654055.4);
/// mas 654055.45 escalado por 10 já cai exatamente em 6540554.5 em f64
/// (sem ruído), e arredondar esse valor pra cima antes de desescalar bate
/// com o que o Excel e o SheetJS mostram (654055.5).
fn format_fixed_decimals(value: f64, decimals: usize) -> String {
    if !value.is_finite() {
        return format!("{value:.decimals$}");
    }
    let factor = 10f64.powi(decimals as i32);
    let scaled = value * factor;
    let rounded = if scaled >= 0.0 {
        (scaled + 0.5).floor()
    } else {
        (scaled - 0.5).ceil()
    };
    format!("{:.decimals$}", rounded / factor)
}

/// "0" -> Some(0), "0.0" -> Some(1), "0.00" -> Some(2), "0.000" -> Some(3),
/// e assim por diante. Qualquer outra coisa (sem prefixo "0", zeros
/// intercalados com outro caractere, código vazio depois do ponto) -> None.
fn fixed_decimal_places(code: &str) -> Option<usize> {
    if code == "0" {
        return Some(0);
    }
    let decimals = code.strip_prefix("0.")?;
    if !decimals.is_empty() && decimals.bytes().all(|b| b == b'0') {
        Some(decimals.len())
    } else {
        None
    }
}

/// Reproduz a exibição do formato "General" do Excel: até 11 dígitos
/// significativos, sem o ruído de arredondamento binário que
/// `f64::to_string()` exibiria (ex.: `111.03999999999999` em vez de
/// `111.04`). Excel arredonda a exibição de "General" a 11 dígitos
/// significativos mesmo guardando mais precisão internamente; o valor
/// bruto (`rawValue`) do contrato continua sendo o `f64` original, sem
/// nenhuma perda — só a representação textual muda.
fn format_general_number(value: f64) -> String {
    const SIGNIFICANT_DIGITS: i32 = 11;
    if !value.is_finite() || value == 0.0 {
        return value.to_string();
    }
    let magnitude = value.abs().log10().floor() as i32;
    let decimals = (SIGNIFICANT_DIGITS - 1 - magnitude).clamp(0, 15) as usize;
    let formatted = format!("{value:.decimals$}");
    trim_trailing_zeros(&formatted)
}

fn trim_trailing_zeros(formatted: &str) -> String {
    if !formatted.contains('.') {
        return formatted.to_string();
    }
    formatted
        .trim_end_matches('0')
        .trim_end_matches('.')
        .to_string()
}

fn builtin_number_format(id: u32) -> &'static str {
    match id {
        1 => "0",
        2 => "0.00",
        9 => "0%",
        10 => "0.00%",
        14 => "m/d/yy",
        15 => "d-mmm-yy",
        16 => "d-mmm",
        17 => "mmm-yy",
        18 => "h:mm AM/PM",
        19 => "h:mm:ss AM/PM",
        20 => "h:mm",
        21 => "h:mm:ss",
        22 => "m/d/yy h:mm",
        45 => "mm:ss",
        46 => "[h]:mm:ss",
        47 => "mmss.0",
        _ => "General",
    }
}

fn enforce_cell_limit(
    cell_count: u64,
    limits: InventoryLimits,
    sheet_name: &str,
) -> Result<(), InventoryError> {
    if cell_count > limits.max_cells {
        return Err(InventoryError::ResourceLimit(format!(
            "a aba '{sheet_name}' possui mais de {} células",
            limits.max_cells
        )));
    }
    Ok(())
}

fn push_structural_record(
    count: &mut u64,
    limits: InventoryLimits,
    sheet_name: &str,
    description: &str,
) -> Result<(), InventoryError> {
    *count = count.checked_add(1).ok_or_else(|| {
        InventoryError::ResourceLimit("contagem de registros estruturais excedeu u64".into())
    })?;
    if *count > limits.max_structural_records {
        return Err(InventoryError::ResourceLimit(format!(
            "a aba '{sheet_name}' possui mais de {} registros de {description}",
            limits.max_structural_records
        )));
    }
    Ok(())
}

fn push_invalid_structure_diagnostic(
    diagnostics: &mut Vec<Diagnostic>,
    sheet_name: &str,
    code: &'static str,
    message: &str,
) {
    diagnostics.push(Diagnostic {
        code,
        severity: DiagnosticSeverity::Warning,
        message: message.to_owned(),
        sheet: Some(sheet_name.to_owned()),
    });
}

fn add_text_bytes(
    total: &mut u64,
    added: usize,
    limits: InventoryLimits,
    part: &str,
) -> Result<(), InventoryError> {
    *total = total
        .checked_add(added as u64)
        .ok_or_else(|| InventoryError::ResourceLimit("contagem de texto excedeu u64".into()))?;
    if *total > limits.max_text_bytes {
        return Err(InventoryError::ResourceLimit(format!(
            "a parte '{part}' excedeu {} bytes de texto",
            limits.max_text_bytes
        )));
    }
    Ok(())
}

fn resolve_general_reference(
    reference: &quick_xml::events::BytesRef<'_>,
    part: &str,
) -> Result<String, InventoryError> {
    if let Some(character) = reference
        .resolve_char_ref()
        .map_err(|source| InventoryError::Xml {
            part: part.into(),
            source,
        })?
    {
        return Ok(character.to_string());
    }
    let name = reference.decode().map_err(|source| InventoryError::Xml {
        part: part.into(),
        source: source.into(),
    })?;
    match name.as_ref() {
        "amp" => Ok("&".into()),
        "lt" => Ok("<".into()),
        "gt" => Ok(">".into()),
        "quot" => Ok("\"".into()),
        "apos" => Ok("'".into()),
        _ => Err(InventoryError::ResourceLimit(format!(
            "a parte '{part}' contém entidade XML não permitida '&{name};'"
        ))),
    }
}

fn attributes(
    element: &BytesStart<'_>,
    decoder: Decoder,
    part: &str,
) -> Result<HashMap<String, String>, InventoryError> {
    let mut result = HashMap::new();
    for attribute in element.attributes() {
        let attribute = attribute.map_err(|source| InventoryError::Xml {
            part: part.into(),
            source: source.into(),
        })?;
        let key = String::from_utf8_lossy(attribute.key.local_name().as_ref()).into_owned();
        let value = attribute
            .decoded_and_normalized_value(XmlVersion::default(), decoder)
            .map_err(|source| InventoryError::Xml {
                part: part.into(),
                source,
            })?
            .into_owned();
        result.insert(key, value);
    }
    Ok(result)
}

fn count_event(
    events: &mut u64,
    limits: InventoryLimits,
    part: &str,
) -> Result<(), InventoryError> {
    *events += 1;
    if *events > limits.max_xml_events {
        return Err(InventoryError::ResourceLimit(format!(
            "a parte '{part}' excedeu {} eventos XML",
            limits.max_xml_events
        )));
    }
    Ok(())
}

fn resolve_relationship_target(base: &str, target: &str) -> Option<String> {
    if target.contains('\0') || target.contains('\\') {
        return None;
    }
    let mut parts: Vec<&str> = if target.starts_with('/') {
        Vec::new()
    } else {
        base.split('/').filter(|part| !part.is_empty()).collect()
    };
    for part in target.trim_start_matches('/').split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            value if value.contains(':') => return None,
            value => parts.push(value),
        }
    }
    (!parts.is_empty()).then(|| parts.join("/"))
}

fn parse_cell_reference(reference: &str) -> Option<(u32, u32)> {
    let reference = reference.replace('$', "");
    let bytes = reference.as_bytes();
    let split = bytes.iter().position(u8::is_ascii_digit)?;
    if split == 0 || split == bytes.len() || !bytes[split..].iter().all(u8::is_ascii_digit) {
        return None;
    }
    let mut column = 0_u32;
    for byte in &bytes[..split] {
        if !byte.is_ascii_alphabetic() {
            return None;
        }
        column = column.checked_mul(26)? + u32::from(byte.to_ascii_uppercase() - b'A' + 1);
    }
    let row = reference[split..].parse::<u32>().ok()?;
    (row > 0).then_some((column, row))
}

fn is_valid_cell_range(reference: &str) -> bool {
    let mut parts = reference.split(':');
    let start = parts.next().and_then(parse_cell_reference);
    let end = parts.next().and_then(parse_cell_reference);
    if parts.next().is_some() {
        return false;
    }
    matches!(
        (start, end),
        (Some((start_column, start_row)), Some((end_column, end_row)))
            if start_column <= end_column
                && start_row <= end_row
                && end_column <= 16_384
                && end_row <= 1_048_576
    )
}

fn encode_cell_reference(mut column: u32, row: u32) -> String {
    let mut letters = Vec::new();
    while column > 0 {
        column -= 1;
        letters.push((b'A' + (column % 26) as u8) as char);
        column /= 26;
    }
    letters.reverse();
    format!("{}{row}", letters.into_iter().collect::<String>())
}

fn is_true(value: &str) -> bool {
    value == "1" || value.eq_ignore_ascii_case("true")
}

#[cfg(test)]
mod unit_tests {
    use super::*;

    #[test]
    fn resolves_safe_relationship_targets() {
        assert_eq!(
            resolve_relationship_target("xl", "worksheets/sheet1.xml").as_deref(),
            Some("xl/worksheets/sheet1.xml")
        );
        assert_eq!(
            resolve_relationship_target("xl", "/xl/worksheets/sheet2.xml").as_deref(),
            Some("xl/worksheets/sheet2.xml")
        );
        assert_eq!(resolve_relationship_target("xl", "../../evil.xml"), None);
    }

    #[test]
    fn parses_and_encodes_cell_references() {
        assert_eq!(parse_cell_reference("$AA$42"), Some((27, 42)));
        assert_eq!(encode_cell_reference(27, 42), "AA42");
        assert_eq!(parse_cell_reference("A0"), None);
        assert!(is_valid_cell_range("A1:XFD1048576"));
        assert!(!is_valid_cell_range("B2:A1"));
        assert!(!is_valid_cell_range("A1:XFE1"));
    }

    #[test]
    fn general_format_rounds_binary_noise_like_excel() {
        // Achado real do corpus XLSM (Etapa 4 / seção 30 do audit): antes
        // desta correção, value.to_string() expunha o ruído de ponto
        // flutuante binário que o Excel/SheetJS arredondam para exibição.
        assert_eq!(format_general_number(111.03999999999999), "111.04");
        assert_eq!(format_general_number(87.91666666666667), "87.916666667");
    }

    #[test]
    fn general_format_preserves_integers_without_trailing_dot() {
        assert_eq!(format_general_number(91.0), "91");
        assert_eq!(format_general_number(0.0), "0");
        assert_eq!(format_general_number(-91.0), "-91");
    }

    #[test]
    fn general_format_handles_simple_decimals_and_negatives() {
        assert_eq!(format_general_number(1234.5), "1234.5");
        assert_eq!(format_general_number(-0.25), "-0.25");
        assert_eq!(format_general_number(0.1), "0.1");
    }

    #[test]
    fn general_format_caps_at_eleven_significant_digits() {
        // Um valor com mais de 11 dígitos significativos é arredondado,
        // não truncado bruto — mesma convenção do Excel para "General".
        assert_eq!(format_general_number(1.234567891234), "1.2345678912");
    }

    #[test]
    fn display_cell_value_uses_general_formatting_for_unformatted_numbers() {
        let value = CellValue::Number(111.03999999999999);
        assert_eq!(display_cell_value(Some(&value), "General"), "111.04");
    }

    #[test]
    fn display_cell_value_respects_fixed_decimal_formats_of_any_length() {
        // Achado real ao sanitizar planilhas do usuário: só "0"/"0.00" eram
        // tratados como decimais fixos; "0.0"/"0.000" caíam em "General" e
        // perdiam o preenchimento de zeros à direita (ex.: "406981" em vez
        // de "406981.0", "550923.24" em vez de "550923.240").
        let value = CellValue::Number(406_981.0);
        assert_eq!(display_cell_value(Some(&value), "0.0"), "406981.0");
        let value = CellValue::Number(550_923.24);
        assert_eq!(display_cell_value(Some(&value), "0.000"), "550923.240");
        let value = CellValue::Number(904_404.74);
        assert_eq!(display_cell_value(Some(&value), "0.0"), "904404.7");
    }

    #[test]
    fn display_cell_value_keeps_previous_fixed_format_behavior() {
        let value = CellValue::Number(91.6);
        assert_eq!(display_cell_value(Some(&value), "0"), "92");
        let value = CellValue::Number(91.6);
        assert_eq!(display_cell_value(Some(&value), "0.00"), "91.60");
        let value = CellValue::Number(0.5);
        assert_eq!(display_cell_value(Some(&value), "0%"), "50%");
        let value = CellValue::Number(0.5);
        assert_eq!(display_cell_value(Some(&value), "0.00%"), "50.00%");
    }

    #[test]
    fn display_cell_value_formats_currency_with_literal_and_grouping() {
        let value = CellValue::Number(888_715.25);
        assert_eq!(
            display_cell_value(Some(&value), "\"R$\"\\ #,##0.00"),
            "R$ 888,715.25"
        );
    }

    #[test]
    fn display_cell_value_formats_accounting_zero_section() {
        let value = CellValue::Number(0.0);
        assert_eq!(
            display_cell_value(
                Some(&value),
                "_(* #,##0.00_);_(* \\(#,##0.00\\);_(* \"-\"??_);_(@_)",
            ),
            " -   "
        );
    }

    #[test]
    fn display_cell_value_formats_currency_family_not_one_literal_code() {
        // O ponto da generalização: os dois casos do corpus passaram a ser
        // instâncias de uma família, não duas comparações de igualdade.
        let value = CellValue::Number(888_715.25);
        assert_eq!(
            display_cell_value(Some(&value), "\"US$\"\\ #,##0.00"),
            "US$ 888,715.25"
        );
        assert_eq!(
            display_cell_value(Some(&value), "\"R$\"#,##0.00"),
            "R$888,715.25"
        );
        assert_eq!(
            display_cell_value(Some(&value), "\"R$\"\\ #,##0"),
            "R$ 888,715"
        );
        assert_eq!(display_cell_value(Some(&value), "#,##0.00"), "888,715.25");
    }

    #[test]
    fn display_cell_value_uses_the_negative_section_when_there_is_one() {
        let value = CellValue::Number(-1_234.5);
        // Com seção dedicada, quem escreve a marca é a própria seção — daí os
        // parênteses e a ausência de sinal.
        assert_eq!(
            display_cell_value(Some(&value), "#,##0.00;(#,##0.00)"),
            "(1,234.50)"
        );
        // Sem seção dedicada, o sinal entra aqui.
        assert_eq!(display_cell_value(Some(&value), "#,##0.00"), "-1,234.50");
    }

    #[test]
    fn display_cell_value_does_not_produce_negative_zero() {
        // A primeira versão consultava `is_sign_negative()` depois de tirar o
        // módulo, e `-0.0` é negativo para o f64: saía "-0.00".
        let value = CellValue::Number(-0.0);
        assert_eq!(display_cell_value(Some(&value), "#,##0.00"), "0.00");
    }

    #[test]
    fn display_cell_value_falls_back_on_codes_that_are_not_modelled() {
        // Cor, condição, científica e data não estão modeladas, e o correto é
        // devolver o comportamento anterior em vez de arriscar um palpite.
        let value = CellValue::Number(1_234.5);
        assert_eq!(
            display_cell_value(Some(&value), "[Red]#,##0.00"),
            format_general_number(1_234.5)
        );
        assert_eq!(
            display_cell_value(Some(&value), "0.00E+00"),
            format_general_number(1_234.5)
        );
        assert_eq!(
            display_cell_value(Some(&value), "dd/mm/yyyy"),
            format_general_number(1_234.5)
        );
    }

    #[test]
    fn split_format_sections_ignores_separator_inside_a_literal() {
        assert_eq!(
            split_format_sections("#,##0;(#,##0)"),
            vec!["#,##0", "(#,##0)"]
        );
        // O `;` dentro das aspas é texto, não separador de seção.
        assert_eq!(split_format_sections("\"a;b\"0"), vec!["\"a;b\"0"]);
    }

    #[test]
    fn display_cell_value_percent_respects_any_decimal_count() {
        let value = CellValue::Number(0.12345);
        assert_eq!(display_cell_value(Some(&value), "0.000%"), "12.345%");
    }

    #[test]
    fn fixed_decimal_places_rejects_non_fixed_codes() {
        assert_eq!(fixed_decimal_places("#,##0.00"), None);
        assert_eq!(fixed_decimal_places("General"), None);
        assert_eq!(fixed_decimal_places("0."), None);
        assert_eq!(fixed_decimal_places(""), None);
    }

    #[test]
    fn display_cell_value_rounds_like_excel_near_the_last_digit() {
        // Achado real ao sanitizar planilhas do usuário: 654055.45 é
        // armazenado como 654055.44999999995343387127 em f64 (ruído binário
        // inevitável, não é bug de parsing). `format!("{:.1}")` direto
        // nesse valor exato arredonda pra baixo (654055.4, "round half to
        // even" do IEEE 754 sobre o valor binário verdadeiro), mas o Excel
        // e o SheetJS mostram "654055.5" porque escalam antes de
        // arredondar (654055.45*10 = 6540554.5 exato em f64, sem ruído).
        let value = CellValue::Number(654_055.45);
        assert_eq!(display_cell_value(Some(&value), "0.0"), "654055.5");
    }

    #[test]
    fn format_fixed_decimals_rounds_negative_numbers_away_from_zero() {
        assert_eq!(format_fixed_decimals(-654_055.45, 1), "-654055.5");
        assert_eq!(format_fixed_decimals(-91.6, 0), "-92");
    }
}
