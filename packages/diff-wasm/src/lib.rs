use serde::{Deserialize, Serialize};
use similar::{Algorithm, ChangeTag, TextDiff};
use wasm_bindgen::prelude::*;

#[derive(Serialize, Deserialize)]
pub struct Change {
    pub value: String,
    pub added: Option<bool>,
    pub removed: Option<bool>,
    pub count: Option<usize>,
}

#[derive(Serialize, Deserialize)]
pub struct Hunk {
    #[serde(rename = "oldStart")]
    pub old_start: usize,
    #[serde(rename = "oldLines")]
    pub old_lines: usize,
    #[serde(rename = "newStart")]
    pub new_start: usize,
    #[serde(rename = "newLines")]
    pub new_lines: usize,
    pub lines: Vec<String>,
}

#[derive(Serialize, Deserialize)]
pub struct ParsedDiff {
    #[serde(rename = "oldFileName")]
    pub old_file_name: Option<String>,
    #[serde(rename = "newFileName")]
    pub new_file_name: Option<String>,
    #[serde(rename = "oldHeader")]
    pub old_header: Option<String>,
    #[serde(rename = "newHeader")]
    pub new_header: Option<String>,
    pub hunks: Vec<Hunk>,
}

#[wasm_bindgen]
pub fn diff_lines_rs(old_str: &str, new_str: &str) -> JsValue {
    let diff = TextDiff::from_lines(old_str, new_str);
    let mut changes: Vec<Change> = Vec::new();

    for change in diff.iter_all_changes() {
        let tag = change.tag();
        let val = change.value().to_string();

        match tag {
            ChangeTag::Equal => {
                if let Some(last) = changes.last_mut() {
                    if last.added.is_none() && last.removed.is_none() {
                        last.value.push_str(&val);
                        last.count = Some(last.count.unwrap_or(0) + 1);
                        continue;
                    }
                }
                changes.push(Change {
                    value: val,
                    added: None,
                    removed: None,
                    count: Some(1),
                });
            }
            ChangeTag::Delete => {
                if let Some(last) = changes.last_mut() {
                    if last.removed == Some(true) {
                        last.value.push_str(&val);
                        last.count = Some(last.count.unwrap_or(0) + 1);
                        continue;
                    }
                }
                changes.push(Change {
                    value: val,
                    added: None,
                    removed: Some(true),
                    count: Some(1),
                });
            }
            ChangeTag::Insert => {
                if let Some(last) = changes.last_mut() {
                    if last.added == Some(true) {
                        last.value.push_str(&val);
                        last.count = Some(last.count.unwrap_or(0) + 1);
                        continue;
                    }
                }
                changes.push(Change {
                    value: val,
                    added: Some(true),
                    removed: None,
                    count: Some(1),
                });
            }
        }
    }

    serde_wasm_bindgen::to_value(&changes).unwrap_or(JsValue::NULL)
}

#[wasm_bindgen]
pub fn create_two_files_patch_rs(
    old_file_name: &str,
    new_file_name: &str,
    old_str: &str,
    new_str: &str,
    old_header: Option<String>,
    new_header: Option<String>,
    context: Option<usize>,
) -> String {
    let ctx = context.unwrap_or(3);
    let diff = TextDiff::configure()
        .algorithm(Algorithm::Myers)
        .diff_lines(old_str, new_str);

    let mut unified = diff.unified_diff();
    let u_diff = unified.context_radius(ctx);
    let header_old = old_header.unwrap_or_default();
    let header_new = new_header.unwrap_or_default();

    format!(
        "Index: {}\n===================================================================\n--- {}\t{}\n+++ {}\t{}\n{}",
        old_file_name,
        old_file_name,
        header_old,
        new_file_name,
        header_new,
        u_diff
    )
}

#[wasm_bindgen]
pub fn structured_patch_rs(
    old_file_name: &str,
    new_file_name: &str,
    old_str: &str,
    new_str: &str,
    old_header: Option<String>,
    new_header: Option<String>,
    context: Option<usize>,
) -> JsValue {
    let ctx = context.unwrap_or(3);
    let diff = TextDiff::configure()
        .algorithm(Algorithm::Myers)
        .diff_lines(old_str, new_str);

    let mut unified = diff.unified_diff();
    let mut hunks_js: Vec<Hunk> = Vec::new();

    for hunk in unified.context_radius(ctx).iter_hunks() {
        let ops = hunk.ops();
        let first = ops.first();
        let last = ops.last();
        let old_start_index = first.map(|op| op.old_range().start).unwrap_or(0);
        let new_start_index = first.map(|op| op.new_range().start).unwrap_or(0);
        let old_start = old_start_index + 1;
        let old_lines = last.map(|op| op.old_range().end).unwrap_or(0) - old_start_index;
        let new_start = new_start_index + 1;
        let new_lines = last.map(|op| op.new_range().end).unwrap_or(0) - new_start_index;

        let mut lines_vec = Vec::new();
        for change in hunk.iter_changes() {
            let prefix = match change.tag() {
                ChangeTag::Equal => " ",
                ChangeTag::Delete => "-",
                ChangeTag::Insert => "+",
            };
            lines_vec.push(format!("{}{}", prefix, change.value().trim_end_matches('\n')));
        }

        hunks_js.push(Hunk {
            old_start,
            old_lines,
            new_start,
            new_lines,
            lines: lines_vec,
        });
    }

    let parsed = ParsedDiff {
        old_file_name: Some(old_file_name.to_string()),
        new_file_name: Some(new_file_name.to_string()),
        old_header,
        new_header,
        hunks: hunks_js,
    };

    serde_wasm_bindgen::to_value(&parsed).unwrap_or(JsValue::NULL)
}
