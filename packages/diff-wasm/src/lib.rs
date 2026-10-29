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
                    if last.added == Some(false) && last.removed == Some(false) {
                        last.value.push_str(&val);
                        last.count = Some(last.count.unwrap_or(0) + 1);
                        continue;
                    }
                }
                changes.push(Change {
                    value: val,
                    added: Some(false),
                    removed: Some(false),
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
                    added: Some(false),
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
                    removed: Some(false),
                    count: Some(1),
                });
            }
        }
    }

    serde_wasm_bindgen::to_value(&changes).unwrap_or(JsValue::NULL)
}

fn unified_hunks(diff: &TextDiff<'_, '_, str>, context: usize) -> Vec<Hunk> {
    let mut unified = diff.unified_diff();
    let mut hunks = Vec::new();

    for hunk in unified.context_radius(context).iter_hunks() {
        let ops = hunk.ops();
        let first = ops.first();
        let last = ops.last();
        let old_start_index = first.map(|op| op.old_range().start).unwrap_or(0);
        let new_start_index = first.map(|op| op.new_range().start).unwrap_or(0);
        let old_lines = last.map(|op| op.old_range().end).unwrap_or(0) - old_start_index;
        let new_lines = last.map(|op| op.new_range().end).unwrap_or(0) - new_start_index;

        let mut lines = Vec::new();
        for change in hunk.iter_changes() {
            let prefix = match change.tag() {
                ChangeTag::Equal => " ",
                ChangeTag::Delete => "-",
                ChangeTag::Insert => "+",
            };
            lines.push(format!(
                "{}{}",
                prefix,
                change.value().trim_end_matches('\n')
            ));
            if change.missing_newline() {
                lines.push("\\ No newline at end of file".to_string());
            }
        }

        hunks.push(Hunk {
            old_start: old_start_index + 1,
            old_lines,
            new_start: new_start_index + 1,
            new_lines,
            lines,
        });
    }

    hunks
}

// The `diff` package always prints both range lengths (`-1,1`), unlike
// `similar`'s unified diff formatter which omits `,1`. Empty ranges are
// printed one line before the range, matching `diff`'s `formatPatch`.
fn format_hunk_header(hunk: &Hunk) -> String {
    let old_start = if hunk.old_lines == 0 {
        hunk.old_start.saturating_sub(1)
    } else {
        hunk.old_start
    };
    let new_start = if hunk.new_lines == 0 {
        hunk.new_start.saturating_sub(1)
    } else {
        hunk.new_start
    };
    format!(
        "@@ -{},{} +{},{} @@",
        old_start, hunk.old_lines, new_start, hunk.new_lines
    )
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
    let ctx = context.unwrap_or(4);
    let diff = TextDiff::configure()
        .algorithm(Algorithm::Myers)
        .diff_lines(old_str, new_str);
    let hunks = unified_hunks(&diff, ctx);

    let header_old = old_header
        .map(|header| format!("\t{}", header))
        .unwrap_or_default();
    let header_new = new_header
        .map(|header| format!("\t{}", header))
        .unwrap_or_default();
    let index = if old_file_name == new_file_name {
        format!("Index: {}\n", old_file_name)
    } else {
        String::new()
    };

    let mut patch = format!(
        "{}===================================================================\n--- {}{}\n+++ {}{}\n",
        index, old_file_name, header_old, new_file_name, header_new
    );
    for hunk in &hunks {
        patch.push_str(&format_hunk_header(hunk));
        patch.push('\n');
        for line in &hunk.lines {
            patch.push_str(line);
            patch.push('\n');
        }
    }
    patch
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
    let ctx = context.unwrap_or(4);
    let diff = TextDiff::configure()
        .algorithm(Algorithm::Myers)
        .diff_lines(old_str, new_str);
    let hunks = unified_hunks(&diff, ctx);

    let parsed = ParsedDiff {
        old_file_name: Some(old_file_name.to_string()),
        new_file_name: Some(new_file_name.to_string()),
        old_header,
        new_header,
        hunks,
    };

    serde_wasm_bindgen::to_value(&parsed).unwrap_or(JsValue::NULL)
}
