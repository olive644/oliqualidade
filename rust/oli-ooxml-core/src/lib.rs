use std::{
    collections::{HashMap, HashSet},
    io::{Cursor, Read, Seek},
    path::Component,
};

use quick_xml::{Reader, XmlVersion, encoding::Decoder, events::BytesStart, events::Event};
use serde::Serialize;
use thiserror::Error;
use zip::ZipArchive;

pub const CONTRACT_VERSION: &str = "1.0.0";
const WORKBOOK_PART: &str = "xl/workbook.xml";
const WORKBOOK_RELS_PART: &str = "xl/_rels/workbook.xml.rels";

#[derive(Debug, Clone, Copy)]
pub struct InventoryLimits {
    pub max_entries: usize,
    pub max_sheets: usize,
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
            max_total_uncompressed_bytes: value.max_total_uncompressed_bytes,
            max_entry_uncompressed_bytes: value.max_entry_uncompressed_bytes,
            suspicious_ratio_min_bytes: value.suspicious_ratio_min_bytes,
            max_compression_ratio: value.max_compression_ratio,
            max_xml_events: value.max_xml_events,
        }
    }
}

#[derive(Debug, Serialize, PartialEq, Eq)]
pub enum DateSystem {
    #[serde(rename = "1900")]
    Excel1900,
    #[serde(rename = "1904")]
    Excel1904,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SheetInventory {
    pub name: String,
    pub sheet_id: Option<String>,
    pub relationship_id: String,
    pub path: Option<String>,
    pub state: SheetState,
    pub declared_dimension: Option<String>,
    pub actual_dimension: Option<ActualDimension>,
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

pub fn inventory_ooxml(bytes: &[u8]) -> Result<WorkbookInventory, InventoryError> {
    inventory_ooxml_with_limits(bytes, InventoryLimits::default())
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
    let mut diagnostics = Vec::new();
    let mut sheets = Vec::with_capacity(workbook_sheets.len());

    for sheet in workbook_sheets {
        let path = relationships
            .get(&sheet.relationship_id)
            .filter(|relationship| !relationship.external)
            .and_then(|relationship| resolve_relationship_target("xl", &relationship.target));

        let (declared_dimension, actual_dimension) = if let Some(path) = path.as_deref() {
            if part_indexes.contains_key(path) {
                let xml = read_part(&mut archive, &part_indexes, path, limits)?;
                parse_worksheet(&xml, path, limits, &sheet.name, &mut diagnostics)?
            } else {
                diagnostics.push(Diagnostic {
                    code: "missing-sheet-part",
                    severity: DiagnosticSeverity::Warning,
                    message: format!("A parte OOXML '{path}' não existe no pacote."),
                    sheet: Some(sheet.name.clone()),
                });
                (None, None)
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
            (None, None)
        };

        sheets.push(SheetInventory {
            name: sheet.name,
            sheet_id: sheet.sheet_id,
            relationship_id: sheet.relationship_id,
            path,
            state: sheet.state,
            declared_dimension,
            actual_dimension,
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
    diagnostics: &mut Vec<Diagnostic>,
) -> Result<(Option<String>, Option<ActualDimension>), InventoryError> {
    let mut reader = Reader::from_reader(xml);
    reader.config_mut().trim_text(true);
    let mut declared_dimension = None;
    let mut bounds: Option<(u32, u32, u32, u32)> = None;
    let mut cell_count = 0_u64;
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
                if element.local_name().as_ref() == b"c" =>
            {
                cell_count += 1;
                if let Some(reference) = attributes(element, reader.decoder(), part)?.get("r")
                    && let Some((column, row)) = parse_cell_reference(reference)
                {
                    bounds = Some(match bounds {
                        Some((min_col, min_row, max_col, max_row)) => (
                            min_col.min(column),
                            min_row.min(row),
                            max_col.max(column),
                            max_row.max(row),
                        ),
                        None => (column, row, column, row),
                    });
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
    Ok((declared_dimension, actual_dimension))
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
    }
}
