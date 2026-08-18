use crate::DateSystem;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ExcelDateTime {
    pub year: i32,
    pub month: u32,
    pub day: u32,
    pub hour: u32,
    pub minute: u32,
    pub second: u32,
    pub excel_leap_day: bool,
}

impl ExcelDateTime {
    pub(crate) fn iso_value(self) -> Option<String> {
        (!self.excel_leap_day).then(|| {
            format!(
                "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}",
                self.year, self.month, self.day, self.hour, self.minute, self.second
            )
        })
    }
}

pub(crate) fn parse_excel_serial(value: f64, system: DateSystem) -> Option<ExcelDateTime> {
    if !value.is_finite() || value < 0.0 {
        return None;
    }

    let mut serial_day = value.floor() as i64;
    let mut seconds = ((value - value.floor()) * 86_400.0).round() as i64;
    if seconds == 86_400 {
        serial_day += 1;
        seconds = 0;
    }

    let (year, month, day, excel_leap_day) = match system {
        DateSystem::Excel1900 if serial_day == 60 => (1900, 2, 29, true),
        DateSystem::Excel1900 => {
            let offset = if serial_day < 60 { 25_568 } else { 25_569 };
            let (year, month, day) = civil_from_days(serial_day - offset);
            (year, month, day, false)
        }
        DateSystem::Excel1904 => {
            let (year, month, day) = civil_from_days(serial_day - 24_107);
            (year, month, day, false)
        }
        // Nunca chamado para formatos sem sistema de série Excel; devolver
        // "sem data" é o comportamento seguro caso isso mude no futuro.
        DateSystem::NotApplicable => return None,
    };

    Some(ExcelDateTime {
        year,
        month,
        day,
        hour: (seconds / 3_600) as u32,
        minute: ((seconds % 3_600) / 60) as u32,
        second: (seconds % 60) as u32,
        excel_leap_day,
    })
}

pub(crate) fn is_date_format(format: &str) -> bool {
    let mut cleaned = String::new();
    let mut chars = format.chars().peekable();
    let mut quoted = false;
    while let Some(character) = chars.next() {
        match character {
            '"' => quoted = !quoted,
            '\\' | '_' | '*' if !quoted => {
                chars.next();
            }
            '[' if !quoted => {
                let mut bracket = String::new();
                for next in chars.by_ref() {
                    if next == ']' {
                        break;
                    }
                    bracket.push(next.to_ascii_lowercase());
                }
                if matches!(bracket.as_str(), "h" | "hh" | "m" | "mm" | "s" | "ss") {
                    cleaned.push_str(&bracket);
                }
            }
            _ if !quoted => cleaned.push(character.to_ascii_lowercase()),
            _ => {}
        }
    }

    cleaned.contains('y')
        || cleaned.contains('d')
        || cleaned.contains('h')
        || cleaned.contains('s')
        || (cleaned.contains('m') && !cleaned.contains(['#', '0']))
}

pub(crate) fn format_excel_date(value: f64, format: &str, date: ExcelDateTime) -> String {
    let normalized = format.trim().to_ascii_lowercase();
    let month = month_name(date.month);
    let hour12 = match date.hour % 12 {
        0 => 12,
        value => value,
    };
    let meridiem = if date.hour < 12 { "AM" } else { "PM" };

    match normalized.as_str() {
        "m/d/yy" => format!(
            "{}/{}/{:02}",
            date.month,
            date.day,
            date.year.rem_euclid(100)
        ),
        "d-mmm-yy" => format!("{}-{}-{:02}", date.day, month, date.year.rem_euclid(100)),
        "d-mmm" => format!("{}-{month}", date.day),
        "mmm-yy" => format!("{month}-{:02}", date.year.rem_euclid(100)),
        "h:mm am/pm" => format!("{hour12}:{:02} {meridiem}", date.minute),
        "h:mm:ss am/pm" => format!("{hour12}:{:02}:{:02} {meridiem}", date.minute, date.second),
        // "h" (uma letra) não preenche a hora com zero à esquerda; "hh" (duas
        // letras) preenche. Minutos e segundos sempre têm duas casas nesses
        // formatos porque "mm"/"ss" é o único par usado no núcleo.
        "h:mm" => format!("{}:{:02}", date.hour, date.minute),
        "hh:mm" => format!("{:02}:{:02}", date.hour, date.minute),
        "h:mm:ss" => format!("{}:{:02}:{:02}", date.hour, date.minute, date.second),
        "hh:mm:ss" => format!("{:02}:{:02}:{:02}", date.hour, date.minute, date.second),
        "m/d/yy h:mm" => format!(
            "{}/{}/{:02} {}:{:02}",
            date.month,
            date.day,
            date.year.rem_euclid(100),
            date.hour,
            date.minute
        ),
        "mm:ss" => format!("{:02}:{:02}", date.minute, date.second),
        "[h]:mm:ss" => {
            let total_seconds = (value * 86_400.0).round() as i64;
            format!(
                "{}:{:02}:{:02}",
                total_seconds / 3_600,
                (total_seconds % 3_600) / 60,
                total_seconds % 60
            )
        }
        "mmss.0" => format!("{:02}{:02}.0", date.minute, date.second),
        "yyyy-mm-dd" => format!("{:04}-{:02}-{:02}", date.year, date.month, date.day),
        "dd/mm/yyyy" => format!("{:02}/{:02}/{:04}", date.day, date.month, date.year),
        "dd/mm/yy" => format!(
            "{:02}/{:02}/{:02}",
            date.day,
            date.month,
            date.year.rem_euclid(100)
        ),
        "mm/dd/yyyy" => format!("{:02}/{:02}/{:04}", date.month, date.day, date.year),
        "yyyy-mm-dd hh:mm:ss" => format!(
            "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
            date.year, date.month, date.day, date.hour, date.minute, date.second
        ),
        _ => format_date_from_pattern(format, date),
    }
}

/// Renderiza um código de formato de data arbitrário do Excel, token a
/// token, em vez de depender de uma lista de strings exatas conhecidas (a
/// tabela em `format_excel_date` cobre os casos mais comuns/testados; esta
/// função é o fallback genérico pra qualquer outro). Achado real ao
/// ampliar o corpus com planilhas do usuário: formatos com prefixo de
/// localidade/cor (`[$-416]mmm\-yy;@`), sem preenchimento de zero
/// (`d/m/yy`) ou simplesmente fora da tabela (`mm/yy`) caíam direto no
/// ISO genérico antigo, mesmo quando um caso "core" equivalente já
/// estava na tabela.
fn format_date_from_pattern(format: &str, date: ExcelDateTime) -> String {
    let section = first_format_section(format);
    let tokens = tokenize_date_format(section);
    let has_am_pm = tokens
        .iter()
        .any(|token| matches!(token, DateToken::AmPm(_)));
    let mut output = String::new();
    for token in &tokens {
        render_date_token(&mut output, token, date, has_am_pm);
    }
    output
}

/// Um código de formato do Excel pode ter até 4 seções separadas por `;`
/// (positivo;negativo;zero;texto) — datas sempre usam a primeira, já que o
/// valor serial de uma data nunca é negativo. `;` dentro de aspas ou de um
/// grupo `[...]` não conta como separador de seção.
fn first_format_section(format: &str) -> &str {
    let mut depth = 0i32;
    let mut quoted = false;
    for (index, character) in format.char_indices() {
        match character {
            '"' => quoted = !quoted,
            '[' if !quoted => depth += 1,
            ']' if !quoted && depth > 0 => depth -= 1,
            ';' if !quoted && depth == 0 => return &format[..index],
            _ => {}
        }
    }
    format
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum RawDateToken {
    Year(usize),
    MonthOrMinute(usize),
    Day(usize),
    Hour(usize),
    Second(usize),
    /// `true` = forma curta "a/p" (renderiza só "A"/"P"); `false` = "am/pm"
    /// (renderiza "AM"/"PM").
    AmPm(bool),
}

#[derive(Debug, Clone, PartialEq)]
enum DateToken {
    Year(usize),
    Month(usize),
    Minute(usize),
    Day(usize),
    Hour(usize),
    Second(usize),
    AmPm(bool),
    Literal(String),
}

fn count_run(chars: &[char], start: usize, matches: impl Fn(char) -> bool) -> usize {
    let mut count = 0;
    while start + count < chars.len() && matches(chars[start + count]) {
        count += 1;
    }
    count.max(1)
}

fn am_pm_len(chars: &[char], start: usize) -> usize {
    let rest: String = chars[start..]
        .iter()
        .collect::<String>()
        .to_ascii_lowercase();
    if rest.starts_with("am/pm") {
        5
    } else if rest.starts_with("a/p") {
        3
    } else {
        0
    }
}

fn am_pm_is_short(chars: &[char], start: usize) -> bool {
    let rest: String = chars[start..]
        .iter()
        .collect::<String>()
        .to_ascii_lowercase();
    !rest.starts_with("am/pm")
}

/// Primeiro passo: separa o código de formato em tokens de data/hora
/// (contando repetição de letra, ex. "mm" -> 2) e trechos literais (texto
/// entre aspas, caractere escapado com `\`, ou qualquer outro caractere de
/// separação como `/`, `-`, `:`, espaço). Grupos `[...]` (localidade, cor,
/// condição — não elapsed-time, que só aparece nos formatos já cobertos
/// pela tabela fixa) são descartados inteiros: não têm efeito nenhum na
/// montagem textual da data. `_X`/`*X` (espaçamento/preenchimento visual
/// do Excel, sem equivalente textual) também são descartados.
fn tokenize_date_format(section: &str) -> Vec<DateToken> {
    let chars: Vec<char> = section.chars().collect();
    let mut raw: Vec<Result<RawDateToken, String>> = Vec::new();
    let mut literal = String::new();
    let mut index = 0;
    while index < chars.len() {
        let character = chars[index];
        match character {
            '"' => {
                index += 1;
                while index < chars.len() && chars[index] != '"' {
                    literal.push(chars[index]);
                    index += 1;
                }
                index += 1;
            }
            '\\' if index + 1 < chars.len() => {
                literal.push(chars[index + 1]);
                index += 2;
            }
            '[' => {
                while index < chars.len() && chars[index] != ']' {
                    index += 1;
                }
                index += 1;
            }
            '_' | '*' if index + 1 < chars.len() => {
                index += 2;
            }
            'a' | 'A' if am_pm_len(&chars, index) > 0 => {
                if !literal.is_empty() {
                    raw.push(Err(std::mem::take(&mut literal)));
                }
                let length = am_pm_len(&chars, index);
                raw.push(Ok(RawDateToken::AmPm(am_pm_is_short(&chars, index))));
                index += length;
            }
            'y' | 'Y' => {
                if !literal.is_empty() {
                    raw.push(Err(std::mem::take(&mut literal)));
                }
                let count = count_run(&chars, index, |c| c == 'y' || c == 'Y');
                raw.push(Ok(RawDateToken::Year(count)));
                index += count;
            }
            'm' | 'M' => {
                if !literal.is_empty() {
                    raw.push(Err(std::mem::take(&mut literal)));
                }
                let count = count_run(&chars, index, |c| c == 'm' || c == 'M');
                raw.push(Ok(RawDateToken::MonthOrMinute(count)));
                index += count;
            }
            'd' | 'D' => {
                if !literal.is_empty() {
                    raw.push(Err(std::mem::take(&mut literal)));
                }
                let count = count_run(&chars, index, |c| c == 'd' || c == 'D');
                raw.push(Ok(RawDateToken::Day(count)));
                index += count;
            }
            'h' | 'H' => {
                if !literal.is_empty() {
                    raw.push(Err(std::mem::take(&mut literal)));
                }
                let count = count_run(&chars, index, |c| c == 'h' || c == 'H');
                raw.push(Ok(RawDateToken::Hour(count)));
                index += count;
            }
            's' | 'S' => {
                if !literal.is_empty() {
                    raw.push(Err(std::mem::take(&mut literal)));
                }
                let count = count_run(&chars, index, |c| c == 's' || c == 'S');
                raw.push(Ok(RawDateToken::Second(count)));
                index += count;
            }
            other => {
                literal.push(other);
                index += 1;
            }
        }
    }
    if !literal.is_empty() {
        raw.push(Err(literal));
    }
    resolve_month_minute(raw)
}

/// Segundo passo: decide se cada "m"/"mm" bruto significa mês ou minuto,
/// igual à regra do próprio Excel — é minuto só quando o token
/// significativo mais próximo antes dele é hora ("h"/"hh"), ou o mais
/// próximo depois é segundo ("s"/"ss"); caso contrário é mês. Trechos
/// literais (separadores, texto) são pulados na busca pelo vizinho.
fn resolve_month_minute(raw: Vec<Result<RawDateToken, String>>) -> Vec<DateToken> {
    let mut tokens = Vec::with_capacity(raw.len());
    for (index, item) in raw.iter().enumerate() {
        match item {
            Err(text) => tokens.push(DateToken::Literal(text.clone())),
            Ok(RawDateToken::Year(count)) => tokens.push(DateToken::Year(*count)),
            Ok(RawDateToken::Day(count)) => tokens.push(DateToken::Day(*count)),
            Ok(RawDateToken::Hour(count)) => tokens.push(DateToken::Hour(*count)),
            Ok(RawDateToken::Second(count)) => tokens.push(DateToken::Second(*count)),
            Ok(RawDateToken::AmPm(is_short)) => tokens.push(DateToken::AmPm(*is_short)),
            Ok(RawDateToken::MonthOrMinute(count)) => {
                let follows_hour = raw[..index]
                    .iter()
                    .rev()
                    .find_map(|entry| entry.as_ref().ok().copied())
                    .is_some_and(|token| matches!(token, RawDateToken::Hour(_)));
                let precedes_second = raw[index + 1..]
                    .iter()
                    .find_map(|entry| entry.as_ref().ok().copied())
                    .is_some_and(|token| matches!(token, RawDateToken::Second(_)));
                tokens.push(if follows_hour || precedes_second {
                    DateToken::Minute(*count)
                } else {
                    DateToken::Month(*count)
                });
            }
        }
    }
    tokens
}

fn render_date_token(output: &mut String, token: &DateToken, date: ExcelDateTime, has_am_pm: bool) {
    match token {
        DateToken::Literal(text) => output.push_str(text),
        DateToken::Year(count) => {
            if *count >= 3 {
                output.push_str(&format!("{:04}", date.year));
            } else {
                output.push_str(&format!("{:02}", date.year.rem_euclid(100)));
            }
        }
        DateToken::Month(count) => match count {
            1 => output.push_str(&date.month.to_string()),
            2 => output.push_str(&format!("{:02}", date.month)),
            3 => output.push_str(month_name(date.month)),
            _ => output.push_str(month_name_full(date.month)),
        },
        DateToken::Day(count) => match count {
            1 => output.push_str(&date.day.to_string()),
            2 => output.push_str(&format!("{:02}", date.day)),
            3 => output.push_str(weekday_name(date.year, date.month, date.day)),
            _ => output.push_str(weekday_name_full(date.year, date.month, date.day)),
        },
        DateToken::Hour(count) => {
            let value = if has_am_pm {
                match date.hour % 12 {
                    0 => 12,
                    other => other,
                }
            } else {
                date.hour
            };
            if *count >= 2 {
                output.push_str(&format!("{value:02}"));
            } else {
                output.push_str(&value.to_string());
            }
        }
        DateToken::Minute(count) => {
            if *count >= 2 {
                output.push_str(&format!("{:02}", date.minute));
            } else {
                output.push_str(&date.minute.to_string());
            }
        }
        DateToken::Second(count) => {
            if *count >= 2 {
                output.push_str(&format!("{:02}", date.second));
            } else {
                output.push_str(&date.second.to_string());
            }
        }
        DateToken::AmPm(is_short) => {
            let (am, pm) = if *is_short { ("A", "P") } else { ("AM", "PM") };
            output.push_str(if date.hour < 12 { am } else { pm });
        }
    }
}

fn month_name_full(month: u32) -> &'static str {
    const MONTHS: [&str; 12] = [
        "January",
        "February",
        "March",
        "April",
        "May",
        "June",
        "July",
        "August",
        "September",
        "October",
        "November",
        "December",
    ];
    MONTHS[(month.saturating_sub(1) as usize).min(11)]
}

fn weekday_name(year: i32, month: u32, day: u32) -> &'static str {
    const DAYS: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    DAYS[day_of_week(year, month, day) as usize]
}

fn weekday_name_full(year: i32, month: u32, day: u32) -> &'static str {
    const DAYS: [&str; 7] = [
        "Sunday",
        "Monday",
        "Tuesday",
        "Wednesday",
        "Thursday",
        "Friday",
        "Saturday",
    ];
    DAYS[day_of_week(year, month, day) as usize]
}

/// Algoritmo de Sakamoto: dia da semana a partir de ano/mês/dia do
/// calendário gregoriano, sem depender do serial Excel. 0 = domingo.
fn day_of_week(year: i32, month: u32, day: u32) -> u32 {
    const OFFSETS: [i32; 12] = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
    let adjusted_year = if month < 3 { year - 1 } else { year };
    let offset_index = (month.saturating_sub(1) as usize).min(11);
    (adjusted_year + adjusted_year / 4 - adjusted_year / 100
        + adjusted_year / 400
        + OFFSETS[offset_index]
        + day as i32)
        .rem_euclid(7) as u32
}

fn month_name(month: u32) -> &'static str {
    const MONTHS: [&str; 12] = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    MONTHS[(month.saturating_sub(1) as usize).min(11)]
}

// Howard Hinnant's civil-from-days algorithm, with day zero at 1970-01-01.
fn civil_from_days(days_since_epoch: i64) -> (i32, u32, u32) {
    let z = days_since_epoch + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let day_of_era = z - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_prime = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_prime + 2) / 5 + 1;
    let month = month_prime + if month_prime < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    (year as i32, month as u32, day as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_both_excel_date_systems_and_the_1900_compatibility_day() {
        let first = parse_excel_serial(1.0, DateSystem::Excel1900).unwrap();
        assert_eq!(first.iso_value().as_deref(), Some("1900-01-01T00:00:00"));
        let zero = parse_excel_serial(0.0, DateSystem::Excel1900).unwrap();
        assert_eq!(zero.iso_value().as_deref(), Some("1899-12-31T00:00:00"));
        let leap = parse_excel_serial(60.5, DateSystem::Excel1900).unwrap();
        assert!(leap.excel_leap_day);
        assert_eq!(
            format_excel_date(60.5, "m/d/yy h:mm", leap),
            "2/29/00 12:00"
        );
        let after_bug = parse_excel_serial(61.0, DateSystem::Excel1900).unwrap();
        assert_eq!(
            after_bug.iso_value().as_deref(),
            Some("1900-03-01T00:00:00")
        );
        let mac_epoch = parse_excel_serial(0.0, DateSystem::Excel1904).unwrap();
        assert_eq!(
            mac_epoch.iso_value().as_deref(),
            Some("1904-01-01T00:00:00")
        );
    }

    #[test]
    fn pads_the_hour_only_when_the_format_doubles_the_h() {
        // Achado medindo paridade contra um workbook real: o núcleo tratava
        // "h:mm" e "hh:mm" como o mesmo formato e nunca preenchia a hora com
        // zero à esquerda. Excel só preenche quando o código repete a letra
        // ("hh"), igual a como TypeScript/SheetJS (`XLSX.SSF.format`) já
        // formata — divergência silenciosa que o shadow mode detectou.
        let morning = parse_excel_serial(0.322_222_222_222, DateSystem::Excel1900).unwrap();
        assert_eq!(format_excel_date(0.0, "h:mm", morning), "7:44");
        assert_eq!(format_excel_date(0.0, "hh:mm", morning), "07:44");
        assert_eq!(format_excel_date(0.0, "h:mm:ss", morning), "7:44:00");
        assert_eq!(format_excel_date(0.0, "hh:mm:ss", morning), "07:44:00");
    }

    #[test]
    fn recognizes_date_tokens_without_treating_quoted_literals_as_dates() {
        assert!(is_date_format("yyyy-mm-dd"));
        assert!(is_date_format("[$-409]d-mmm-yy"));
        assert!(is_date_format("[h]:mm:ss"));
        assert!(!is_date_format("0.00"));
        assert!(!is_date_format("0 \"days\""));
    }

    fn date(year: i32, month: u32, day: u32) -> ExcelDateTime {
        ExcelDateTime {
            year,
            month,
            day,
            hour: 0,
            minute: 0,
            second: 0,
            excel_leap_day: false,
        }
    }

    #[test]
    fn generic_date_pattern_handles_formats_missing_from_the_fixed_table() {
        // Achados reais ao sanitizar planilhas de calibração do usuário: nenhum
        // desses 5 formatos estava na tabela fixa, e caíam no ISO genérico
        // antigo mesmo tendo um equivalente "core" já testado (ex.: "mmm-yy"
        // já existe na tabela, mas a versão com prefixo de localidade não
        // batia com o match exato).
        assert_eq!(format_excel_date(0.0, "mm/yy", date(2019, 9, 9)), "09/19");
        assert_eq!(
            format_excel_date(0.0, "d/m/yy;@", date(2032, 1, 25)),
            "25/1/32"
        );
        assert_eq!(
            format_excel_date(0.0, "[$-416]mmm\\-yy;@", date(2032, 1, 15)),
            "Jan-32"
        );
        assert_eq!(
            format_excel_date(0.0, "[$-816]mmm/yy;@", date(2034, 4, 8)),
            "Apr/34"
        );
        assert_eq!(
            format_excel_date(0.0, "dd/mm/yy;@", date(2031, 12, 11)),
            "11/12/31"
        );
    }

    #[test]
    fn generic_date_pattern_resolves_month_vs_minute_by_neighboring_token() {
        // "m" é minuto só perto de h/s; longe dos dois, é mês — mesma regra
        // do próprio Excel, exercitada nos dois sentidos (antes de "s" e
        // depois de "h") e no caso puramente de mês (nem antes nem depois).
        let mut with_time = date(2026, 3, 5);
        with_time.hour = 7;
        with_time.minute = 8;
        with_time.second = 9;
        assert_eq!(format_excel_date(0.0, "m:ss", with_time), "8:09");
        assert_eq!(format_excel_date(0.0, "h:m", with_time), "7:8");
        assert_eq!(
            format_excel_date(0.0, "yyyy/mm/dd", with_time),
            "2026/03/05"
        );
    }

    #[test]
    fn generic_date_pattern_supports_full_month_and_weekday_names() {
        // 2000-01-01 é sábado, data amplamente conhecida — usada como
        // referência independente pra conferir day_of_week sem depender de
        // nenhuma outra função deste módulo.
        let millennium = date(2000, 1, 1);
        assert_eq!(
            format_excel_date(0.0, "dddd, mmmm d, yyyy", millennium),
            "Saturday, January 1, 2000"
        );
        assert_eq!(format_excel_date(0.0, "ddd", millennium), "Sat");
    }

    #[test]
    fn generic_date_pattern_supports_am_pm_outside_the_fixed_table() {
        let mut afternoon = date(2026, 3, 5);
        afternoon.hour = 15;
        afternoon.minute = 30;
        assert_eq!(format_excel_date(0.0, "h:mm a/p", afternoon), "3:30 P");
        assert_eq!(format_excel_date(0.0, "h:mm am/pm", afternoon), "3:30 PM");
    }
}
