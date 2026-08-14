use std::{env, fs, process::ExitCode};

fn main() -> ExitCode {
    let Some(path) = env::args_os().nth(1) else {
        eprintln!("Uso: oli-ooxml-core <arquivo.xlsx>");
        return ExitCode::from(2);
    };
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) => {
            eprintln!("Não foi possível ler o arquivo: {error}");
            return ExitCode::FAILURE;
        }
    };
    match oli_ooxml_core::inventory_ooxml(&bytes) {
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
