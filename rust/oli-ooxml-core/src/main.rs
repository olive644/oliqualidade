use std::{env, fs, process::ExitCode};

fn main() -> ExitCode {
    let Some(path) = env::args_os().nth(1) else {
        eprintln!("Uso: oli-ooxml-core <arquivo.xlsx|arquivo.ods>");
        return ExitCode::from(2);
    };
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) => {
            eprintln!("Não foi possível ler o arquivo: {error}");
            return ExitCode::FAILURE;
        }
    };
    let is_ods = std::path::Path::new(&path)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("ods"));
    let result = if is_ods {
        oli_ooxml_core::inventory_ods(&bytes)
    } else {
        oli_ooxml_core::inventory_ooxml(&bytes)
    };
    match result {
        Ok(inventory) => match serde_json::to_string_pretty(&inventory) {
            Ok(json) => {
                println!("{json}");
                ExitCode::SUCCESS
            }
            Err(error) => {
                eprintln!("Não foi possível serializar o inventário: {error}");
                ExitCode::FAILURE
            }
        },
        Err(error) => {
            eprintln!("Falha ao inventariar o workbook: {error}");
            ExitCode::FAILURE
        }
    }
}
