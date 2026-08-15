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
        _ if date.hour == 0 && date.minute == 0 && date.second == 0 => {
            format!("{:04}-{:02}-{:02}", date.year, date.month, date.day)
        }
        _ => format!(
            "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
            date.year, date.month, date.day, date.hour, date.minute, date.second
        ),
    }
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
}
