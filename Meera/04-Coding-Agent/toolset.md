# Phase 4: Coding Agent Toolset & Sandbox Specification

## Toolset Design (Compact 5-Tool Model)

To prevent cognitive degradation on 7B models, the toolset is strictly capped to 5 core operations:

### 1. `read_file`
- **Parameters**: `path` (string, relative to project root), `start_line` (optional int), `end_line` (optional int)
- **Description**: Reads contents of a file within the sandbox root.

### 2. `write_file`
- **Parameters**: `path` (string), `content` (string), `overwrite` (boolean)
- **Description**: Creates or fully replaces a file.

### 3. `edit_file`
- **Parameters**: `path` (string), `target_text` (string), `replacement_text` (string)
- **Description**: Applies an exact string search-and-replace edit to an existing file.

### 4. `run_shell`
- **Parameters**: `command` (string), `timeout_seconds` (int, default 30)
- **Description**: Executes a shell command strictly scoped inside the project working directory.

### 5. `git_op`
- **Parameters**: `subcommand` (string: "status" | "diff" | "commit" | "log"), `args` (array of strings)
- **Description**: Performs safe, tracked version control operations.

---

## Sandbox & Safety Gates

1. **Path Traversal Prevention**:
   - Every file path is validated using `path.resolve()` ensuring it remains within `PROJECT_ROOT`.
   - Any attempt to access paths with `..` outside `PROJECT_ROOT` or system paths (`C:\Windows`, `C:\Program Files`, user roots) throws a security violation.

2. **Confirmation Gate for Destructive Actions**:
   - Terminal UI prompts user for explicit confirmation `[y/N]` before executing:
     - File deletions or batch overwrites.
     - Dangerous shell commands (`rm`, `del`, `format`, `git reset --hard`, `git push --force`).
