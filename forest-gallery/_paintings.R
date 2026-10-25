# _paintings.R
# Shared by index.qmd (grid gallery) and forest.qmd (3D forest).
# Reads paintings.yml + scans images/paintings/ and builds `imgs` and `paintings_json`.
# (Files starting with "_" are not rendered by Quarto.)

# ── Read optional metadata ────────────────────────────────────────────────────
yml_path <- "paintings.yml"
meta_map <- list()
raw      <- list()
if (file.exists(yml_path)) {
  raw <- yaml::read_yaml(yml_path)
  for (entry in raw) {
    if (!is.null(entry$file)) meta_map[[tolower(entry$file)]] <- entry
  }
}

# ── Scan images folder ────────────────────────────────────────────────────────
all_imgs <- list.files(
  "images/paintings",
  pattern     = "\\.(jpg|jpeg|png|webp)$",
  full.names  = FALSE,
  ignore.case = TRUE
)

# Build ordered list: YAML order first, then unlisted images appended
yml_files <- vapply(raw, function(e) if (is.null(e$file)) "" else e$file, character(1))
yml_files <- yml_files[tolower(yml_files) %in% tolower(all_imgs)]
rest      <- all_imgs[!tolower(all_imgs) %in% tolower(yml_files)]
imgs      <- c(yml_files, rest)

# ── Build JSON string (no external packages needed) ───────────────────────────
esc_json <- function(s) {
  s <- as.character(s)
  s <- gsub("\\\\", "\\\\\\\\", s)   # escape backslashes first
  s <- gsub('"',    '\\\\"',    s)   # escape double quotes
  s
}

entries <- vapply(imgs, function(img) {
  m      <- meta_map[[tolower(img)]]
  title  <- esc_json(if (!is.null(m$title))  m$title              else tools::file_path_sans_ext(img))
  year   <- esc_json(if (!is.null(m$year))   as.character(m$year) else "")
  medium <- esc_json(if (!is.null(m$medium)) m$medium             else "")
  format <- esc_json(if (!is.null(m$format)) m$format             else "")
  group  <- esc_json(if (!is.null(m$group))  m$group              else "default")
  sprintf('{"file":"%s","title":"%s","year":"%s","medium":"%s","format":"%s","group":"%s"}',
          esc_json(img), title, year, medium, format, group)
}, character(1))

paintings_json <- paste0("[", paste(entries, collapse = ","), "]")
