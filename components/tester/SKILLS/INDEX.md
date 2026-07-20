# SKILLS — agent knowledge base

This is a curated, battle-tested knowledge base of procedures for GUI
interactions that are otherwise error-prone and tend to waste turns on
trial-and-error (file/folder dialogs, menus, notifications, and similar fiddly
UI). It is baked into the image at the absolute path `/SKILLS`.

## How this base is organized

The base is **recursive and multi-level**:

1. This file (`/SKILLS/INDEX.md`) is the entry point. It lists **categories**,
   each of which is a sub-directory with its own `INDEX.md`.
2. Each category `INDEX.md` lists the concrete **skills** in that category (and
   may itself link to further sub-categories, each again with an `INDEX.md`).
3. Each skill is a single markdown file describing one procedure.

Skills may cross-reference one another using relative links; every link
resolves under `/SKILLS`.

## How to use it

1. When you are about to perform an interaction that is known to be fiddly (for
   example, choosing a folder in an "open folder" dialog), start here.
2. Follow the link to the relevant **category** index below.
3. Open the specific **skill** and follow its procedure, choosing the AT-SPI or
   pixel path that matches the app under test.

## Categories

| Category | Index | Covers |
|----------|-------|--------|
| Dialogs  | [dialogs/INDEX.md](dialogs/INDEX.md) | File and folder open/save dialogs (GTK, Qt, Avalonia, …). |

More categories will be added over time; each new one is a sub-directory with
its own `INDEX.md` linked from the table above.

## Skill file conventions

Every skill file follows the same section structure so procedures stay
consistent and quick to scan:

- **Purpose** — what the skill accomplishes, in one line.
- **When to use** — the trigger that tells you this skill applies.
- **Preconditions** — what must be true first (e.g. which interaction path the
  app supports).
- **Procedure (AT-SPI path)** — ordered steps when the app exposes an
  accessibility tree.
- **Procedure (pixel path)** — ordered steps when the app exposes only an X
  window (no AT-SPI).
- **Verification** — how to confirm the action actually worked.
- **Common failures & recovery** — known failure modes and concrete remedies.
- **Related skills** — links to sibling / prerequisite skills.

Skills describe *what* to do — "type the path", "press Enter", "double-click
the folder", "click the accept button" — not which specific tool to invoke.
Picking the right tool for each action, from those available to you, is your
job.
