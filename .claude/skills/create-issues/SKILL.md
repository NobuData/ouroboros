---
name: create-issues
description: Creates issues from a ROADMAP file
---

# Implement (`/create-issues <roadmap-file>`)

When user invokes **create-issues**, refer to `docs/<roadmap-file>.md` as the description of the work to be referenced.

## Guidelines

- Use `gh` command to create issues
- Reuse labels in issues, create where necessary
- Parent issues must be assigned using Relationships
- Projects and Milestones need not apply

## Create Issues

- Create GitHub issues in order of requirements listed in `docs/<roadmap-file>.md`
- Issues must contain:
  - Quick summary including:
    - Level of effort (shirt sizes: S, M, L, XL)
    - Affected systems (UI/UX, REST, Database, Engine, etc)
  - Problem Statement
  - Solution/Scope
  - Acceptance Criteria
  - Parallelism/Dependencies
  - Technical Stack
  - Epic grouping (Epic name is 3 letters of the major feature)
  - Relationship Reference where applicable
  - MVP indicator (v1) release candidate where applicable
  - Labels indicating all of the appropriate pairings for the issue
  - Type (Bug/Feature/Task)
  - Project if applicable
  - Milestone if applicable
- Mark issue number in ROADMAP for each issue created for reference, along with its status
- Use Mermaid diagrams to illustrate changes, work, or database tables/references
- Note "Created by **Ouroboros**" at the footer of the issue

