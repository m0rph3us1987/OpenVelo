# GitBranchFS

A FUSE filesystem that exposes a single git branch of any local repository as
a mountable directory. Edits made through the mount are captured as overlay
or deletion entries in a per-mountpoint overlay directory under
`~/.gitbranchfs/` (configurable via `~/.gitbranchfs/config.json`, see
[Configuration](#configuration)), and standard git commands (`git status`,
`git add`, `git commit`, `git push`, ...) run inside the mount and persist
directly into the original repository — the working copy on disk is never
modified by file operations alone, but commits land normally.

## The problem

Working with a git branch often means juggling three things at once:

- a `git worktree add <path> <branch>` setup that duplicates the repo on disk
  and burns through disk space,
- a stash / patch workflow to ferry changes between checkouts,
- and the constant `git checkout` overhead to switch between branches.

`gbfs` removes the duplication and the juggling. It mounts **one**
branch of a repository at a time, reads content from the branch's tree, and
captures every write as a lightweight overlay file under
`~/.gitbranchfs/<repo>/<branch>/<mount-id>/`. The `<mount-id>` is derived
deterministically from the canonical mount point, so each mountpoint gets its
own dedicated overlay and `.git` database — you can mount the **same** branch
at several mountpoints at once without them clobbering each other, and
remounting the same mountpoint resumes its overlay. Because the overlay's
`.git/` folder points back at the original repo via `commondir`, normal git
commands (`git status`, `git add`, `git commit`, `git push`, ...) work from
inside the mount and land the changes directly in the original repository — no
copying files out of the overlay, no manual cleanup.

It is intentionally small: one C11 binary, two subcommands, no daemon, no
service, no lockfile, no background process. Mount, work, git commit,
unmount.

## Install

### Windows

To compile on Windows, you need:
- **Visual Studio 2022** (with "Desktop development with C++" workload) or Build Tools.
- **WinFSP** (Windows File System Proxy), which can be downloaded from the [WinFSP website](https://winfsp.dev/).

To build:
1. Run [get_libgit2.bat](file:///E:/Development/gbfs/get_libgit2.bat) to automatically download and build `libgit2` with built-in regex (zero dependencies, bypassing `pcre` issues):
   ```cmd
   get_libgit2.bat
   ```
2. Run [build.bat](file:///E:/Development/gbfs/build.bat) to compile the project (it will auto-detect the built libgit2):
   ```cmd
   build.bat
   ```
   `build.bat` will automatically download and build `jansson` (via `get_jansson.bat`) the first time it runs, if neither a built `jansson-2.15.1\` directory nor a vcpkg install is present. Pass `--no-jansson-autobuild` to disable this and supply `--jansson "C:\path\to\jansson"` if jansson is installed elsewhere.

The output binary will be a statically linked `gbfs.exe` in the root folder (libgit2 and the C runtime are linked statically, with only `winfsp-x64.dll` required dynamically since it interfaces with the WinFSP host kernel driver).

### Debian / Ubuntu

```bash
sudo apt install build-essential pkg-config libgit2-dev libfuse3-dev libjansson-dev
make
sudo make install   # optional; see "Install system-wide" below
```

### Fedora

```bash
sudo dnf install gcc make pkgconfig libgit2-devel fuse3-devel jansson-devel
make
```

### Arch

```bash
sudo pacman -S base-devel pkgconf libgit2 fuse3 jansson
make
```

The binary is `./gbfs` on Linux/macOS and `gbfs.exe` on Windows after building.

### Install system-wide

`make install` works on any distro once the binary is built. It copies
`gbfs` to `/usr/local/bin` by default (usually requires `sudo`):

```bash
sudo make install     # installs /usr/local/bin/gbfs
```

The location is overridable via the standard `PREFIX`, `BINDIR`, and
`DESTDIR` variables, e.g. `sudo make install PREFIX=/usr` installs to
`/usr/bin`, and `make install DESTDIR=/tmp/stage` stages the install under
`/tmp/stage` without touching the real system.

To remove it again:

```bash
sudo make uninstall
```

## Configuration

Application settings are read from `~/.gitbranchfs/config.json` (on Windows the
same path, resolved against `HOME` / `USERPROFILE`). If the configuration file
does not exist, it is automatically created with the default settings (using the
historical hardcoded defaults) when the application is started for the first time.
Malformed JSON or a wrongly-typed field is reported on stderr and the affected field
falls back to its default.

Currently supported fields:

| Field           | Type   | Default                | Description                                          |
|-----------------|--------|------------------------|------------------------------------------------------|
| `overlay_path`  | string | `~/.gitbranchfs`       | Root directory used for per-mount overlay state. The final overlay path is `<overlay_path>/<repo>/<branch>/<mount-id>/`. May be an absolute path or use `~` for the user's home directory. |

Example:

```json
{
  "overlay_path": "/var/lib/gitbranchfs"
}
```

When `overlay_path` is set, both `gbfs mount` and (on Windows) `gbfs unmount`
honor the configured root, so unmount locates the correct `gbfs.pid` file.

## Usage

### Mount a branch

Run the command from **inside** the git repository you want to mount — the
current working directory is used as the repository.

```bash
cd /path/to/repo
gbfs mount mybranch /tmp/gbfs
```

Output:

```
Initializing GitBranchFS:
  Git Repository: /path/to/repo
  Branch:         mybranch
  Mount Point:    /tmp/gbfs
  Overlay Path:   /home/<you>/.gitbranchfs/<repo-name>/mybranch/<mount-id>
Mounting filesystem...
```

The command blocks in the foreground while the FUSE loop runs. 

To run it in the background:
- **On Linux/macOS**: Append `&` to the command:
  ```bash
  gbfs mount mybranch /tmp/gbfs &
  ```
- **On Windows**: Pass the `-d` or `--background` flag:
  ```cmd
  gbfs.exe windows E:\gbfs333 -d
  ```
  This will natively spawn the daemon process in the background and redirect its output logs to a `gbfs_daemon.log` file in the current directory.

Alternatively, you can use shell-level backgrounding on Windows:
- **On Command Prompt (cmd)**: `start /b gbfs.exe windows E:\gbfs333`
- **On PowerShell**: `Start-Process -NoNewWindow -FilePath .\gbfs.exe -ArgumentList "windows", "E:\gbfs333"`

To unmount:
- **On Linux/macOS**: Run `gbfs unmount /tmp/gbfs` (or press `Ctrl-C` if running in the foreground).
- **On Windows**: Terminate the background process (e.g. via `Ctrl-C` if in foreground, or stopping the task/process). If mounted as a drive letter, you can also run `gbfs unmount X:`.

### Inspect the resolved branch

If the branch name does not resolve to a local branch, an exact ref, or a
DWIM match, `gbfs` creates a **new local branch** of that name at the current
HEAD commit and mounts it, printing a note:

```
Branch 'dev' not found. Creating new local branch 'dev' from HEAD (main).
```

The new branch is a real, persistent branch in your repository (equivalent to
`git branch dev` at the current HEAD). It has no upstream configured, so it
behaves like a fresh local branch with no remote counterpart — commits land on
it (never on the default branch), and a later `git push` (e.g.
`git push -u origin dev`) is what creates the remote branch.

### List / read files through the mount

Standard UNIX tooling works as expected:

```bash
ls -la /tmp/gbfs
cat /tmp/gbfs/README.md
cp /path/to/repo/Makefile /tmp/gbfs/Makefile
grep -R . /tmp/gbfs/src
```

Files read through the mount come from the resolved branch's git tree, with
any overlay entries under `~/.gitbranchfs/<repo>/<branch>/<mount-id>/` taking
precedence. A synthetic `.git` entry appears at the mount root so `git`
operations inside the mount resolve against the original repo via the standard
`commondir` indirection.

### Edit / create / delete files through the mount

Any write to the mount is captured as an overlay file under
`~/.gitbranchfs/<repo>/<branch>/<mount-id>/`, so the original repo's working
tree on disk is not mutated by file operations alone:

```bash
# Edit an existing tracked file
echo "# extra heading" >> /tmp/gbfs/README.md

# Create a new file
mkdir -p /tmp/gbfs/docs
printf 'hello\n' > /tmp/gbfs/docs/notes.md

# Delete a tracked file
rm /tmp/gbfs/legacy.c
```

The corresponding overlay entries show up immediately under:

```
~/.gitbranchfs/<repo-name>/mybranch/<mount-id>/
├── deleted                          # one path per line
├── README.md                        # bytes you wrote
└── docs/
    └── notes.md                     # new file from above
```

### Persist changes via git from inside the mount

The overlay's `.git/` folder is synthesised at mount time so that
`commondir` points back at the original repo. That means the standard git
workflow runs against the original repo without leaving the mount:

```bash
cd /tmp/gbfs
git status                 # shows README.md modified, new docs/notes.md, legacy.c deleted
git add README.md docs/notes.md
git rm legacy.c            # also marks the path in ~/.gitbranchfs/<repo>/<branch>/<mount-id>/deleted
git commit -m "wire up docs, drop legacy"
git push origin mybranch
```

`git status` / `git add` / `git commit` / `git push` all operate on the
original repo's objects and refs. The overlay files remain on disk for the
duration of the mount and are how `git` sees the in-memory changes; once
the new commit is in place, the overlay entries are conceptually absorbed
into the branch. To discard the session without committing:

```bash
rm -rf ~/.gitbranchfs/<repo-name>/mybranch/<mount-id>
```

### Unmount

From the same terminal that mounted (with `Ctrl-C`):

```
^C
```

Or from any other shell:

```bash
gbfs unmount /tmp/gbfs
Unmounting /tmp/gbfs...
Unmounted successfully.
```

## Command reference

```
gbfs [mount] <branch-name> <mount-point>
gbfs unmount <mount-point>
```

The `mount` keyword is optional — invoking `gbfs <branch-name> <mount-point>`
with exactly two positional arguments is treated as a mount. The `mount`
command uses the current working directory as the git repository and errors out
if the current directory is not a git repository. The mount point must be
**outside** the repository — it cannot be the repository directory itself or
any subfolder of it. If the mount-point directory does not exist, `gbfs` asks
whether to create it (`Create it? [Y/n]`, default **yes**); if it already
exists it must be an empty directory, otherwise the mount fails.

| Command   | Purpose                                                                                |
|-----------|----------------------------------------------------------------------------------------|
| `mount`   | Resolve `<branch>` in the current working directory (which must be a git repository, creating a new local branch off HEAD if it doesn't exist), prepare the overlay root at `~/.gitbranchfs/<repo>/<branch>/<mount-id>/` (the `<mount-id>` is derived from the canonical mount point, giving each mountpoint its own dedicated overlay and `.git`), and run `fuse_main` against `<mount-point>` in-process. |
| `unmount` | Run `fusermount3 -u "<mount-point>"`. Prints success or the failing status to the corresponding stream. |

## Exit codes

| Code | Meaning                                                                          |
|------|----------------------------------------------------------------------------------|
| `0`  | Mount succeeded and the FUSE loop exited cleanly (graceful unmount). Unmount succeeded. |
| `1`  | Bad arguments, current directory not a git repository, `realpath` / `mkdir` failure, `gbfs_init` failure, or `fusermount3 -u` failed. Error text is on stderr. |
| other| The `fuse_main` exit code propagates on `mount` when the loop returns.            |

## Caveats

- The branch's tree is captured once at mount time. Changes to the underlying
  repo (new commits on the branch, switching to a different branch) are not
  visible until you unmount and remount.
- The same branch may be mounted at several distinct mountpoints at once:
  each mountpoint gets its own dedicated overlay and `.git` database under
  `~/.gitbranchfs/<repo>/<branch>/<mount-id>/`, so the mounts stay isolated
  and remounting the same mountpoint resumes its overlay. What is *not*
  serialised is two concurrent `gbfs mount` invocations against the **same**
  `<mount-point>` — mount each mountpoint once.
- When a branch name doesn't resolve to an existing local branch, exact ref,
  or DWIM match, `gbfs` creates a new local branch of that name at the current
  HEAD commit (a persistent side effect) and mounts it — commits land on the
  new branch, not the default branch. An empty repository with no commits has
  no base to branch from, so the mount fails in that case.
- FUSE operations `symlink` / `readlink` / `access` / `flush` / `opendir` /
  `releasedir` are not supported. `statfs` is implemented and reports the
  overlay host volume's free space (required on Windows so WinFSP does not
  surface "disk full" on every write).
- Single-threaded FUSE (`-s` is passed to `fuse_main`); `make` on the host must
  have access to `libgit2-dev` ≥ 1.5 and `libfuse3-dev`.

## Project layout

```
.
├── Makefile             -- handwritten GNU Make; `make` builds ./gbfs
├── include/             -- public headers (cli.h, core_fs.h, fuse_ops.h, ...)
├── src/
│   ├── main.c           -- main() -> cli_run()
│   ├── cli.c            -- mount / unmount dispatch
│   ├── git_wrapper.c    -- libgit2 wrapper + four-level branch lookup
│   ├── overlay.c        -- deleted list + overlay_write_blob
│   ├── core_fs.c        -- gbfs_state lifecycle + file operations
│   ├── core_dir.c       -- readdir merging + dir operations
│   ├── fuse_ops.c       -- libfuse3 vtable + run_fuse_fs
│   └── utils.c          -- path helpers
└── .openvelo/architecture/   -- internal architecture documentation
```

See `.openvelo/architecture/_INDEX.md` for the full breakdown.

## License

This project is licensed under the Apache License 2.0. See
[`LICENSE`](./LICENSE) in the repository root for the full text.
