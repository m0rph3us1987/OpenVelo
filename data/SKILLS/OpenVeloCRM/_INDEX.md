# OpenVeloCRM SKILLS Index

This index contains a registry of all available standard operating procedures and technical guides for OpenVeloCRM. Each SKILL is designed to instruct agents on specific workflows, architectures, or architectural rules.

| Skill File Location | Description |
| :--- | :--- |
| `general_architecture/general_architecture.md` | Core philosophy (metadata-driven), monorepo structure, high-level wiring of the auto-migrator, generic API controllers, dynamic frontend routes, Master Forms, and Golden Rules for AI Agents. |
| `entities/creating_entities.md` | Step-by-step guide on how to build new entities, define JSON metadata files (`entity.json`, `list.json`, `main.json`, etc.), set up UI configurations, strict primary key UUID rules, and how the automatic database migrator works. |
| `business_logic/business_logic_layer.md` | Explains how the Business Logic Layer works, including creating the entity-named JavaScript file for lifecycle hooks (`onInsert`, `onUpdate`, `onDelete`) and field-level validation (`<fieldName>_onValidate`) using an ES6 class. |
| `business_logic/system_api.md` | Acts as an index for the BLL `system` object documentation. Details Active Record CRUD operations (`getRecord`, `insertRecord`, etc.) and real-time SSE UI communication methods (`info`, `error`, `confirm`). |
| `system_metadata/sidepanel_navigation.md` | Explains how the left navigation sidebar is configured via `sidepanel.json`, how to add/remove entities from the menu, and the concept of orphaned entities. |
